/**
 * The weekly review: what the week actually contained, written to its own note.
 *
 * Same division of labour as the briefing, for the same reason. The figures —
 * hours ticked and hours timed against hours planned, where they went by
 * workspace and by quadrant, what got done, what has been open longest — are
 * queries over the markdown and the index. A model is asked only for a few sentences of
 * commentary on top, and when it is unavailable the note is still written
 * with the numbers.
 *
 * Unlike the briefing this never writes without a click. The briefing earns
 * its exception by replacing a region between two markers in a note the user
 * opened that morning anyway; a weekly review creates a note that did not
 * exist, and a file appearing in someone's vault unannounced is exactly the
 * thing G1 is for. So it produces a proposal and the Sunday job leaves it
 * where the user will find it: as a `create` edit they accept, or not.
 */

import { dailyNotePath, shiftDay, type DayKey } from '../daily';
import { config } from '../config';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';
import { loadWorkspaces } from '../workspaces';
import { loadEntries, weekOf, weekSummary, type WeekSummary } from '../timelog';
import { displayText, isDone, isOpen, type Task } from '$lib/shared/task';
import { formatDuration } from '$lib/shared/duration';
import { checkBudget, checkKillSwitch } from './guardrails';
import { enqueue } from './pending';
import { newId } from './proposal';
import { loadSettings } from './settings';
import { logRun, spentOn } from './audit';
import { runClaude, type CliDeps } from './cli';
import type { Proposal, RunStamp } from '$lib/shared/ai';

/** `Journal/Weekly/2026-W38.md`, which is the folder G4 lets this feature write. */
export function reviewPath(week: DayKey[]): string {
	return `${config.dailyNote.folder}/Weekly/${weekLabel(week)}.md`;
}

/** ISO week label, `2026-W38`, computed from the Monday the week starts on. */
export function weekLabel(week: DayKey[]): string {
	const monday = week[0];
	const [y, m, d] = monday.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	// The ISO year is the year of the Thursday in this week, which is what
	// keeps the last days of December in week 1 of the next year.
	const thursday = new Date(date);
	thursday.setUTCDate(date.getUTCDate() + 3);
	const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
	const week1Monday = new Date(firstThursday);
	week1Monday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7));
	const number = Math.round((date.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1;
	return `${thursday.getUTCFullYear()}-W${String(number).padStart(2, '0')}`;
}

export interface WeekFacts {
	week: DayKey[];
	summary: WeekSummary;
	/** Tasks completed in the week's daily notes, in the order they were done. */
	finished: Task[];
	/** Open tasks anywhere with a quadrant, oldest note first: the backlog. */
	carrying: Task[];
}

/**
 * Everything the review says, gathered from the vault and the index.
 *
 * Inputs: the vault, the index and any day in the week. Output: the figures
 * and the two lists. Side effects: reads the week's notes.
 *
 * Never invents a number and never reads a model, which is why a failed CLI
 * costs the commentary and nothing else.
 */
export async function gather(vault: Vault, index: NoteIndex, day: DayKey): Promise<WeekFacts> {
	const week = weekOf(day);
	const workspaces = await loadWorkspaces(vault);
	const summary = await weekSummary(vault, index, { days: week, workspaces, workspace: null });

	const finished = week.flatMap((d) => index.tasksIn(dailyNotePath(d)).filter((t) => !t.fenced && isDone(t)));

	const carrying = index
		.findTasks({
			statuses: ['todo', 'in-progress', 'blocked'],
			requireQuadrant: true,
			excludeDailyNotes: true,
			limit: 30
		})
		.filter(isOpen);

	return { week, summary, finished, carrying };
}

/**
 * The note body, as markdown.
 *
 * Pure, so the exact bytes are table-tested. Never emits frontmatter this
 * vault does not already use, and never emits an empty section: a week with
 * nothing logged says so in a sentence rather than showing three empty
 * headings, because an empty heading reads as a bug.
 */
export function render(facts: WeekFacts, commentary = ''): string {
	const { summary } = facts;
	const lines = [`# Week of ${facts.week[0]}`, ''];

	if (commentary.trim()) lines.push(commentary.trim(), '');

	lines.push('## Time', '');
	if (summary.doneMinutes === 0 && summary.loggedMinutes === 0 && summary.plannedMinutes === 0) {
		lines.push('Nothing planned and nothing logged this week.', '');
	} else {
		// Ticked and timed are named apart, because they are two different
		// claims: one says the block happened, the other measured it.
		lines.push(
			`- ${formatDuration(summary.doneMinutes)} done and ${formatDuration(summary.loggedMinutes)} timed against ${formatDuration(summary.plannedMinutes)} planned.`
		);
		for (const w of summary.byWorkspace.filter((w) => w.minutes > 0)) {
			lines.push(`- ${w.name}: ${formatDuration(w.minutes)}`);
		}
		for (const q of summary.byQuadrant.filter((q) => q.minutes > 0)) {
			lines.push(`- ${q.quadrant === null ? 'Unclassified' : `Q${q.quadrant}`}: ${formatDuration(q.minutes)}`);
		}
		lines.push('');
	}

	if (summary.unmatched.length) {
		lines.push('## Unplanned', '', 'Logged but never planned:', '');
		for (const u of summary.unmatched.slice(0, 10)) {
			lines.push(`- ${u.text} (${formatDuration(u.minutes)})`);
		}
		lines.push('');
	}

	if (facts.finished.length) {
		lines.push('## Finished', '');
		for (const t of facts.finished) lines.push(`- ${displayText(t.text)}`);
		lines.push('');
	}

	if (facts.carrying.length) {
		lines.push('## Still open', '');
		for (const t of facts.carrying) {
			lines.push(`- ${displayText(t.text)} — [[${t.path.replace(/\.md$/, '')}]]`);
		}
		lines.push('');
	}

	return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

/**
 * The review as a proposal: one `create` edit, never applied here.
 *
 * Inputs: the facts, the commentary and the stamp. Output: a proposal of one
 * edit, with nothing pre-accepted. Side effects: none.
 *
 * Never targets a note outside `Journal/Weekly/`, which is also all G4 lets
 * this feature write, so a bug in `reviewPath` is a refusal rather than a
 * file somewhere unexpected.
 */
export function propose(facts: WeekFacts, commentary: string, stamp: RunStamp): Proposal {
	const path = reviewPath(facts.week);
	return {
		id: newId('weekly'),
		feature: 'weekly-review',
		stamp,
		summary: `Weekly review for ${weekLabel(facts.week)}: ${formatDuration(facts.summary.doneMinutes + facts.summary.loggedMinutes)} tracked, ${facts.finished.length} finished, ${facts.carrying.length} still open.`,
		edits: [
			{
				id: newId('edit'),
				kind: 'create',
				path,
				text: render(facts, commentary),
				reason: 'A new note. Nothing existing is touched.'
			}
		],
		accepted: []
	};
}

export interface WeeklyReviewRun {
	week: DayKey[];
	proposal: Proposal | null;
	/** Set when the note is already there; the review is not offered twice. */
	existing: string | null;
	problem: string | null;
}

/**
 * Produce the week's review, ready for a human to accept.
 *
 * Inputs: the vault and index, any day in the week. Output: the proposal, or
 * the path of the note that is already there. Side effects: spawns the CLI
 * for the commentary, appends to the audit log. Never writes a note.
 *
 * Never overwrites an existing review. A user who wrote their own week's
 * notes at that path gets told it exists, not a proposal to replace it.
 */
export async function run(
	deps: { vault: Vault; index: NoteIndex },
	day: DayKey,
	options: { cli?: Partial<CliDeps> } = {}
): Promise<WeeklyReviewRun> {
	const week = weekOf(day);
	const path = reviewPath(week);
	const settings = await loadSettings(deps.vault);
	const chosen = settings.features['weekly-review'];
	const startedAt = new Date().toISOString();

	const existing = await deps.vault.read(path);
	if (existing.exists) return { week, proposal: null, existing: path, problem: null };

	const stop = checkKillSwitch(settings.enabled);
	if (stop.length) return { week, proposal: null, existing: null, problem: stop[0].message };

	const facts = await gather(deps.vault, deps.index, day);
	const spend = await spentOn(deps.vault, day);
	const budget = checkBudget(chosen, { todayUsd: spend.usd, running: 0 }, settings.budget);

	let commentary = '';
	let durationMs = 0;
	let costUsd = 0;
	if (budget.refusals.length === 0) {
		const result = await runClaude(
			{
				prompt: commentaryPrompt(facts),
				settings: { ...budget.settings, permission: 'read-only' },
				systemPrompt:
					'You are writing three or four sentences about one person\'s week, from their own figures. ' +
					'Be specific and plain. Name what went as planned and what did not. No preamble, no encouragement, no lists.'
			},
			options.cli
		);
		commentary = result.ok ? result.text.trim() : '';
		durationMs = result.durationMs;
		costUsd = result.ok ? result.costUsd : 0;
	}

	const stamp: RunStamp = { ...budget.settings, feature: 'weekly-review', startedAt, durationMs, costUsd };
	const proposal = propose(facts, commentary, stamp);

	await logRun(deps.vault, {
		at: startedAt,
		feature: 'weekly-review',
		model: stamp.model,
		effort: stamp.effort,
		permission: stamp.permission,
		paths: [path],
		decision: 'proposed',
		guardrails: [],
		costUsd,
		durationMs,
		note: proposal.summary
	});

	// Nobody is watching on a Sunday evening, so the proposal goes in the queue
	// the review page reads. Returned as well, for a caller that asked for it.
	await enqueue(deps.vault, proposal);
	return { week, proposal, existing: null, problem: null };
}

/** The prompt for the commentary. Figures only: there is nothing here to corrupt. */
function commentaryPrompt(facts: WeekFacts): string {
	const { summary } = facts;
	return [
		`Week of ${facts.week[0]} to ${facts.week[6]}.`,
		`Planned ${formatDuration(summary.plannedMinutes)}, ${formatDuration(summary.doneMinutes)} ticked as done, ${formatDuration(summary.loggedMinutes)} timed.`,
		'',
		'By workspace:',
		...summary.byWorkspace.filter((w) => w.minutes > 0).map((w) => `- ${w.name}: ${formatDuration(w.minutes)}`),
		'',
		'By quadrant:',
		...summary.byQuadrant
			.filter((q) => q.minutes > 0)
			.map((q) => `- ${q.quadrant === null ? 'Unclassified' : `Q${q.quadrant}`}: ${formatDuration(q.minutes)}`),
		'',
		`Finished ${facts.finished.length} tasks. ${facts.carrying.length} remain open with a quadrant.`,
		'',
		'Logged but never planned:',
		...summary.unmatched.slice(0, 10).map((u) => `- ${u.text} (${formatDuration(u.minutes)})`)
	].join('\n');
}

/** The day the review covers when asked for "last week" from a Monday. */
export function lastWeek(day: DayKey): DayKey {
	return shiftDay(weekOf(day)[0], -1);
}
