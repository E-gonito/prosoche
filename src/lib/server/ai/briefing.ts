/**
 * The morning briefing: what today looks like, drafted for today's note.
 *
 * The briefing is shown on screen, and written into the note only after Save
 * to note is pressed, which is CLAUDE.md's rule against a model writing
 * without an explicit accept step; there is no exception for it. So this
 * module only ever proposes: it emits a `replace-region` edit and lets
 * `proposal.replaceRegion` rebuild the note as head, marker, new body,
 * marker, tail, with all four of those pieces taken verbatim from the file,
 * and the edit is applied through the ordinary accept step.
 *
 * The facts come from the index, not from a model: what is scheduled, what is
 * overdue, what is blocked, what yesterday left unfinished are all queries.
 * A model is only asked to write the sentence at the top, and if it is not
 * available the briefing still proposes, with the facts and no sentence. A
 * planner that goes blank because an API was slow is worse than a plain one.
 */

import { dailyNotePath, shiftDay, type DayKey } from '../daily';
import { formatMinutes } from '$lib/shared/time';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';
import { config } from '../config';
import { displayText, isDone, isOpen, matchKey, type Task } from '$lib/shared/task';
import { compareCards, type OpenCard } from '$lib/shared/kanban';
import { openCards } from '../kanban';
import { loadWorkspaces } from '../workspaces';
import { wrapAsData } from './guardrails';
import { markerBlock, newId, readRegion } from './proposal';
import { runDraft } from './run';
import type { CliDeps } from './cli';
import type { BriefingRun, Proposal, RunStamp } from '$lib/shared/ai';

export type { BriefingRun };

/** The comment pair in a daily note that the briefing's text sits between. */
export const BRIEFING_MARKER = 'hub:briefing';

interface BriefingFacts {
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
	 * The few cards each workspace's board has open that the day does not
	 * already plan. Empty for a vault with no boards, or one where every card
	 * is already on the day.
	 */
	fromWorkspaces: Array<{ workspace: { slug: string; name: string; color: string }; cards: OpenCard[] }>;
}

/** How many of a workspace's cards a briefing is willing to name. */
const CARDS_PER_WORKSPACE = 3;

/**
 * Everything the briefing says, gathered from the index.
 *
 * Inputs: the index, the day, and every open card on the workspaces'
 * boards, as `kanban.openCards` reads them. Output: five lists. Side effects:
 * none beyond reads of the index.
 *
 * Never invents a task and never reads a model: this is the part of the
 * briefing that is simply true, which is why it is also the part that keeps
 * working when the CLI is down.
 */
export function gather(index: NoteIndex, day: DayKey, cards: OpenCard[]): BriefingFacts {
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

	// What each board has waiting, minus whatever the day already plans. A
	// task on the day that quotes a card's words is that card planned, so the
	// card's key contained in the task's is the test — the same way a time
	// log line is matched to the block it measured.
	const planned = index
		.tasksIn(todayPath)
		.filter((t) => !t.fenced)
		.map((t) => matchKey(t.text))
		.filter(Boolean);
	const groups = new Map<string, BriefingFacts['fromWorkspaces'][number]>();
	for (const card of cards) {
		const key = matchKey(card.title);
		if (key === '' || planned.some((p) => p.includes(key))) continue;
		const group = groups.get(card.workspace.slug) ?? { workspace: card.workspace, cards: [] };
		group.cards.push(card);
		groups.set(card.workspace.slug, group);
	}
	const fromWorkspaces = [...groups.values()].map((group) => ({
		...group,
		cards: group.cards.sort(compareCards).slice(0, CARDS_PER_WORKSPACE)
	}));

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
			group.cards.map((card) => `- ${group.workspace.name}: ${displayText(card.title)} — ${link(card.path)}`)
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
 * a flag. When the markers are there it is a `replace-region` edit. When they
 * are not it is an `append` edit that adds a `## Briefing` heading and the
 * markers. Both wait for Save to note, like every proposal.
 *
 * Never targets any note but the day's own, and never produces more than one
 * edit.
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
		accepted: []
	};
}

/**
 * The prompt for the one sentence a model contributes.
 *
 * Inputs: the facts. Output: a prompt. Side effects: none. Never asks for
 * anything but prose - the lists are already written, so there is nothing for
 * a malformed answer to corrupt, and the worst case is a sentence that gets
 * dropped. The task text is the user's own writing, so it goes in as data
 * (G8), never as part of the instruction.
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
		wrapAsData([{ path: dailyNotePath(facts.day), text: facts.scheduled.map((t) => `- ${displayText(t.text)}`).join('\n') }])
	].join('\n');
}

/* -------------------------------------------------------------- running --- */

interface BriefingDeps {
	vault: Vault;
	index: NoteIndex;
}

/**
 * Produce the day's briefing, and draft it as a proposal rather than writing it.
 *
 * Inputs: the vault and index, and the day. Output: a proposal for the card
 * to offer, or the problem that stopped one. Side effects: spawns the CLI for
 * the opening sentence through the shared runner, which logs the run. Never
 * writes to the vault; the caller applies the proposal through the ordinary
 * `/api/ai/proposal` accept step, the same as every other feature.
 *
 * Never throws and never leaves the card empty. The facts come from the
 * index, so a CLI that is missing, refused or over budget costs the sentence
 * and nothing else - the lists still get proposed. Only the kill switch stops
 * the briefing outright, because off means off. That is the whole reason the
 * model's part is one paragraph at the top rather than the briefing itself.
 *
 * When the note has no markers yet, the proposal only adds them; the body
 * text is not written until a second draft, run after that proposal is
 * accepted, finds them there and offers the `replace-region` edit instead.
 */
export async function run(deps: BriefingDeps, day: DayKey, options: { cli?: Partial<CliDeps> } = {}): Promise<BriefingRun> {
	const path = dailyNotePath(day);
	// Only Obsidian makes daily notes, so a briefing has nowhere to be saved
	// until it has. Refused before the model is called, so it costs nothing.
	if (!(await deps.vault.read(path)).exists) {
		return { proposal: null, problem: 'Today’s note is not here yet. Open it in Obsidian, then Brief me once it has synced.' };
	}

	// Read here rather than taken as a dependency: a route handing this
	// module a vault and an index is enough, and a workspace file is a note
	// in that vault like any other.
	const facts = gather(deps.index, day, await openCards(deps.vault, await loadWorkspaces(deps.vault)));
	const opener = await runDraft(deps.vault, {
		feature: 'briefing',
		prompt: openerPrompt(facts),
		system: 'Write plainly. Two sentences at most. No preamble, no sign-off, no lists.',
		paths: [path],
		note: 'briefing opener',
		cli: options.cli
	});
	if (!opener.ok && opener.refusals.some((r) => r.guardrail === 'G10')) return { proposal: null, problem: opener.problem };

	// Any other failure is the same answer here: no sentence. Deliberately not
	// reported as a problem, because a briefing without its opening line is a
	// briefing, and a red message above a perfectly good list would train the
	// user to ignore red messages.
	const proposal = await propose(deps.vault, day, facts, opener.ok ? opener.value : '', opener.stamp);
	return { proposal, problem: null };
}
