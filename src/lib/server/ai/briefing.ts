/**
 * The morning briefing: what today looks like, written into today's note.
 *
 * This is the one automatic write in the whole application, so it is the one
 * that has to be argued for. SPEC 7.2.1 allows it on a single condition: it
 * may replace the text between `<!-- hub:briefing start -->` and
 * `<!-- hub:briefing end -->` in today's note, and nothing else, ever. That
 * condition is kept by construction rather than by care - the briefing emits
 * a `replace-region` edit and `proposal.replaceRegion` rebuilds the note as
 * head, marker, new body, marker, tail, with all four of those pieces taken
 * verbatim from the file. There is no code path here that produces a whole
 * note.
 *
 * The facts come from the index, not from a model: what is scheduled, what is
 * overdue, what is blocked, what yesterday left unfinished are all queries.
 * A model is only asked to write the sentence at the top, and if it is not
 * available the briefing still writes, with the facts and no sentence. A
 * planner that goes blank because an API was slow is worse than a plain one.
 */

import { dailyNotePath, formatMinutes, shiftDay, type DayKey } from '../daily';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';
import { config } from '../config';
import { displayText, isDone, isOpen, matchKey, type Task } from '$lib/shared/task';
import { compareTasks, openCards } from '../board';
import { loadWorkspaces, type Workspace } from '../workspaces';
import { BRIEFING_MARKER, checkBudget, checkKillSwitch } from './guardrails';
import { apply, markerBlock, newId, policyFor, readRegion } from './proposal';
import { enqueue } from './pending';
import { loadSettings } from './settings';
import { logRun, spentOn } from './audit';
import { runClaude, type CliDeps } from './cli';
import type { BriefingRun, BudgetLimits, Proposal, RunSettings, RunStamp } from '$lib/shared/ai';

export type { BriefingRun };

export interface BriefingFacts {
	day: DayKey;
	/** Today's scheduled blocks, in clock order. */
	scheduled: Task[];
	/** Open tasks anywhere with a due date at or before today. */
	overdue: Task[];
	/** Open tasks waiting on another task. */
	blocked: Task[];
	/** Yesterday's open tasks, which is the list that stings. */
	unfinished: Task[];
	/**
	 * The few cards each workspace has open that the day does not already
	 * plan. Empty for a vault with no workspaces, or one where every board is
	 * already on the day.
	 */
	fromWorkspaces: Array<{ workspace: { slug: string; name: string; color: string }; cards: Task[] }>;
}

/** How many of a workspace's cards a briefing is willing to name. */
const CARDS_PER_WORKSPACE = 3;

/**
 * Everything the briefing says, gathered from the index.
 *
 * Inputs: the index, the day and the workspace definitions. Output: five
 * lists. Side effects: none beyond reads.
 *
 * Never invents a task and never reads a model: this is the part of the
 * briefing that is simply true, which is why it is also the part that keeps
 * working when the CLI is down.
 */
export function gather(index: NoteIndex, day: DayKey, workspaces: Workspace[]): BriefingFacts {
	const todayPath = dailyNotePath(day);
	const yesterdayPath = dailyNotePath(shiftDay(day, -1));

	const scheduled = index
		.tasksIn(todayPath)
		.filter((t) => t.startMin !== null)
		.sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));

	// Other days' journals are excluded: they are copies of one template, so
	// every past day would contribute the same unfinished checklist.
	const overdue = index
		.findTasks({ dueOnOrBefore: day, statuses: ['todo', 'in-progress', 'blocked'], excludePrefixes: [config.dailyNote.folder], limit: 40 })
		.filter(isOpen);

	const blocked = index
		.findTasks({ blocked: true, statuses: ['todo', 'in-progress', 'blocked'], excludePrefixes: [config.dailyNote.folder], limit: 40 })
		.filter(isOpen);

	const unfinished = index.tasksIn(yesterdayPath).filter((t) => !t.fenced && isOpen(t) && !isDone(t));

	// What each project has waiting, minus whatever the day already plans.
	// A card planned onto the day becomes a block that quotes its words and
	// links back to it, so the card's key is contained in the block's rather
	// than equal to it, and containment is the test — the same way a time log
	// line is matched to the block it measured.
	const planned = index
		.tasksIn(todayPath)
		.filter((t) => !t.fenced)
		.map((t) => matchKey(t.text))
		.filter(Boolean);
	const fromWorkspaces = workspaces
		.map((w) => ({
			workspace: { slug: w.slug, name: w.name, color: w.color },
			cards: openCards(index, w, workspaces)
				.filter((task) => {
					const key = matchKey(task.text);
					return key !== '' && !planned.some((p) => p.includes(key));
				})
				.sort(compareTasks)
				.slice(0, CARDS_PER_WORKSPACE)
		}))
		.filter((group) => group.cards.length > 0);

	return { day, scheduled, overdue, blocked, unfinished, fromWorkspaces };
}

/**
 * Render the facts as the markdown that goes between the markers.
 *
 * Inputs: the facts and, optionally, one sentence from the model. Output: the
 * region body. Side effects: none - pure, so the exact bytes are table-tested.
 *
 * Never emits the markers themselves; that is `replaceRegion`'s job, and
 * having one function that knows both would be the way the markers eventually
 * get duplicated into a note. Never emits an empty body: a day with nothing
 * in it says so, because a blank region looks like a failure.
 */
export function render(facts: BriefingFacts, opener = ''): string {
	const lines: string[] = [];
	if (opener.trim()) lines.push(opener.trim(), '');

	const section = (title: string, items: string[]): void => {
		if (items.length === 0) return;
		lines.push(`**${title}**`, ...items, '');
	};

	section(
		'Scheduled',
		facts.scheduled.map((t) => {
			const time = t.startMin === null ? '' : `${formatMinutes(t.startMin)}${t.endMin === null ? '' : `-${formatMinutes(t.endMin)}`} `;
			return `- ${time}${displayText(t.text)}${isDone(t) ? ' ✅' : ''}`;
		})
	);
	section('Overdue', facts.overdue.map((t) => `- ${displayText(t.text)} (due ${t.due}) — ${link(t.path)}`));
	section('Blocked', facts.blocked.map((t) => `- ${displayText(t.text)} waiting on ${t.blockedBy.join(', ')} — ${link(t.path)}`));
	section(
		'From your workspaces',
		facts.fromWorkspaces.flatMap((group) =>
			group.cards.map((t) => `- ${group.workspace.name}: ${displayText(t.text)} — ${link(t.path)}`)
		)
	);
	section('Not finished yesterday', facts.unfinished.map((t) => `- ${displayText(t.text)}`));

	if (lines.length === 0) {
		lines.push('Nothing scheduled, nothing overdue, nothing blocked. A clear day.');
	}
	return lines.join('\n').replace(/\n+$/, '');
}

function link(path: string): string {
	return `[[${path.replace(/\.md$/, '')}]]`;
}

/**
 * The briefing as a proposal.
 *
 * Inputs: the vault, the day, the facts, an optional opening sentence, and
 * the stamp of the run that produced it. Output: a proposal of exactly one
 * edit. Side effects: reads today's note.
 *
 * Two shapes, and which one comes back is decided by the note rather than by
 * a flag. When the markers are there it is a `replace-region` edit, which is
 * the only thing G1's exception permits to apply itself. When they are not it
 * is an `append` edit that adds a `## Briefing` heading and the markers, and
 * that one is an ordinary proposal needing a click - because putting a new
 * heading into someone's note is exactly the sort of change they should see
 * first.
 *
 * Never targets any note but the day's own, and never produces more than one
 * edit, which is what keeps it inside the exception.
 */
export async function propose(
	vault: Vault,
	day: DayKey,
	facts: BriefingFacts,
	opener: string,
	stamp: RunStamp
): Promise<Proposal> {
	const path = dailyNotePath(day);
	const note = await vault.read(path);
	const body = render(facts, opener);
	const hasMarkers = readRegion(note.content, BRIEFING_MARKER) !== null;

	const edit = hasMarkers
		? {
				id: newId('edit'),
				kind: 'replace-region' as const,
				path,
				marker: BRIEFING_MARKER,
				text: body,
				reason: 'The briefing region of today\'s note, regenerated.'
			}
		: {
				id: newId('edit'),
				kind: 'append' as const,
				path,
				text: `\n## Briefing\n${markerBlock(BRIEFING_MARKER)}\n`,
				reason: 'Today\'s note has no briefing markers yet. This adds them; nothing else changes.'
			};

	return {
		id: newId('briefing'),
		feature: 'briefing',
		stamp,
		summary: hasMarkers
			? `Briefing for ${day}: ${facts.scheduled.length} scheduled, ${facts.overdue.length} overdue, ${facts.unfinished.length} left from yesterday.`
			: `Add the briefing markers to ${path}.`,
		edits: [edit],
		// The marker form applies itself under G1's exception; the other form
		// waits for a human, so nothing is pre-accepted here either way.
		accepted: []
	};
}

/**
 * The prompt for the one sentence a model contributes.
 *
 * Inputs: the facts. Output: a prompt. Side effects: none. Never asks for
 * anything but prose - the lists are already written, so there is nothing for
 * a malformed answer to corrupt, and the worst case is a sentence that gets
 * dropped.
 */
export function openerPrompt(facts: BriefingFacts): string {
	return [
		'Write one or two sentences introducing this person\'s day. Be plain and specific.',
		'Do not list the tasks again; they are already written below your sentence.',
		'Say what the shape of the day is and what looks likely to be squeezed.',
		'',
		`Scheduled: ${facts.scheduled.length}. Overdue: ${facts.overdue.length}.`,
		`Blocked: ${facts.blocked.length}. Unfinished yesterday: ${facts.unfinished.length}.`,
		'',
		facts.scheduled.map((t) => `- ${displayText(t.text)}`).join('\n')
	].join('\n');
}

/* -------------------------------------------------------------- running --- */

export interface BriefingDeps {
	vault: Vault;
	index: NoteIndex;
}

/**
 * Produce today's briefing and, when the note allows it, write it.
 *
 * Inputs: the vault and index, the day, and whether this was asked for or
 * fired by the clock. Output: what the card should show. Side effects: may
 * write the briefing region of one note, spawns the CLI for the opening
 * sentence, appends to the audit log.
 *
 * Never throws and never leaves the card empty. The facts come from the
 * index, so a CLI that is missing, refused or over budget costs the sentence
 * and nothing else - the lists still get written. That is the whole reason
 * the model's part is one paragraph at the top rather than the briefing
 * itself.
 *
 * Never writes without markers. A note that has none gets a proposal back,
 * which is an ordinary click, because adding a heading to someone's note is a
 * change they should see before it happens.
 */
export async function run(
	deps: BriefingDeps,
	day: DayKey,
	options: { regenerate?: boolean; cli?: Partial<CliDeps> } = {}
): Promise<BriefingRun> {
	const settings = await loadSettings(deps.vault);
	const chosen = settings.features.briefing;
	const startedAt = new Date().toISOString();
	const stamp: RunStamp = { ...chosen, feature: 'briefing', startedAt, durationMs: 0, costUsd: 0 };
	const path = dailyNotePath(day);

	const existing = readRegion((await deps.vault.read(path)).content, BRIEFING_MARKER);
	if (existing !== null && !options.regenerate) {
		return { day, text: existing, proposal: null, problem: null, stamp };
	}

	const stop = checkKillSwitch(settings.enabled);
	if (stop.length) {
		return { day, text: existing, proposal: null, problem: stop[0].message, stamp };
	}

	// Read here rather than taken as a dependency: the scheduled job and the
	// route both hand this module a vault and an index, and a workspace file
	// is a note in that vault like any other.
	const facts = gather(deps.index, day, await loadWorkspaces(deps.vault));
	const opener = await openingSentence(deps.vault, facts, chosen, settings.budget, options.cli);
	const proposal = await propose(deps.vault, day, facts, opener.text, { ...stamp, ...opener.spent });

	// The marker form is G1's exception and applies itself; the other form is a
	// proposal the user accepts. `apply` decides which by asking the guardrail,
	// not by trusting the shape we think we built.
	const policy = policyFor('briefing', settings, { today: day });
	const result = await apply(deps.vault, proposal, policy);

	await logRun(deps.vault, {
		at: startedAt,
		feature: 'briefing',
		model: chosen.model,
		effort: chosen.effort,
		permission: chosen.permission,
		paths: result.written,
		decision: result.written.length ? 'applied' : 'proposed',
		guardrails: [...new Set(result.refusals.map((r) => r.guardrail))],
		costUsd: opener.spent.costUsd,
		durationMs: opener.spent.durationMs,
		note: proposal.summary
	});

	if (result.written.length) {
		return {
			day,
			text: readRegion((await deps.vault.read(path)).content, BRIEFING_MARKER),
			proposal: null,
			problem: null,
			stamp: { ...stamp, ...opener.spent }
		};
	}

	// Nothing was written, which means the note has no markers and adding them
	// needs a click. Queue it, so a briefing the 07:00 job could not apply is
	// still waiting on the review page rather than lost.
	await enqueue(deps.vault, proposal);
	return {
		day,
		text: existing,
		proposal,
		problem: null,
		stamp: { ...stamp, ...opener.spent }
	};
}

/**
 * The one sentence a model contributes, or an empty one.
 *
 * A refusal, a missing CLI and a spent budget are all the same answer here:
 * no sentence. Deliberately not reported to the caller as a problem, because
 * a briefing without its opening line is a briefing, and a red message above
 * a perfectly good list would train the user to ignore red messages.
 */
async function openingSentence(
	vault: Vault,
	facts: BriefingFacts,
	settings: RunSettings,
	limits: BudgetLimits,
	cli: Partial<CliDeps> = {}
): Promise<{ text: string; spent: { durationMs: number; costUsd: number } }> {
	const spend = await spentOn(vault, facts.day);
	const budget = checkBudget(settings, { todayUsd: spend.usd, running: 0 }, limits);
	if (budget.refusals.length) return { text: '', spent: { durationMs: 0, costUsd: 0 } };

	const result = await runClaude(
		{
			prompt: openerPrompt(facts),
			settings: { ...budget.settings, permission: 'read-only' },
			systemPrompt: 'Write plainly. Two sentences at most. No preamble, no sign-off, no lists.'
		},
		cli
	);
	return {
		text: result.ok ? result.text.trim() : '',
		spent: { durationMs: result.durationMs, costUsd: result.ok ? result.costUsd : 0 }
	};
}
