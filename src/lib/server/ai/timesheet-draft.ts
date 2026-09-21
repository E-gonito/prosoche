/**
 * A draft of today's timesheet entry, for the user to paste in themselves.
 *
 * `timesheet.ts` says there is no writer for that document and there must not
 * be one: it is shared at work, its numbered items are cited in
 * conversations, and a rewrite that renumbered or reflowed them would
 * silently change a document the user is accountable for. That holds here.
 * This feature produces *text*, in the shape those files use, and the app
 * never touches `TIMESHEET *.md`.
 *
 * Which makes the output unusual for this layer: the draft is returned to be
 * read and copied, and the proposal — if the user wants one at all — writes to
 * a scratch note under `_hub/drafts/`, never to the timesheet. Accepting
 * nothing is a perfectly good outcome here, and the copy button is the
 * primary action.
 *
 * ## Where the facts come from
 *
 * The clock line comes from the day's first and last logged entries. The work
 * items come from the tasks completed in today's note and the time log lines,
 * which is the same pair the weekly review uses. A model is asked only to
 * group and phrase them the way the existing file does — the hours are
 * arithmetic and are never sent to it as something to decide.
 */

import { config } from '../config';
import { dailyNotePath, formatMinutes, type DayKey } from '../daily';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';
import { loadEntries, type TimeEntry } from '../timelog';
import { displayText, isDone } from '$lib/shared/task';
import { formatDuration } from '$lib/shared/duration';
import { checkBudget, checkKillSwitch, validateModelOutput, wrapAsData, type Schema } from './guardrails';
import { newId } from './proposal';
import { loadSettings } from './settings';
import { logRun, spentOn } from './audit';
import { runClaude, type CliDeps } from './cli';
import type { Proposal, Refusal, RunStamp } from '$lib/shared/ai';

/** Where a saved draft goes. Never the timesheet itself. */
export function draftPath(day: DayKey): string {
	return `${config.hubFolder}/drafts/timesheet-${day}.md`;
}

const SCHEMA: Schema = {
	type: 'object',
	fields: {
		todo: { type: 'array', maxItems: 12, of: { type: 'string', minLength: 3, maxLength: 300 } },
		done: { type: 'array', maxItems: 12, of: { type: 'string', minLength: 3, maxLength: 300 } },
		blockers: { type: 'string', maxLength: 300 }
	},
	optional: ['blockers']
};

interface Grouped {
	todo: string[];
	done: string[];
	blockers?: string;
}

export interface DraftFacts {
	day: DayKey;
	entries: TimeEntry[];
	/** What today's note says was finished. */
	finished: string[];
	/** What today's note has open with a time on it. */
	planned: string[];
	firstMin: number | null;
	lastMin: number | null;
	loggedMinutes: number;
}

export interface TimesheetDraft {
	day: DayKey;
	/** The draft, in the shape the timesheet files use. Copy this. */
	text: string;
	facts: DraftFacts;
	/** An edit that saves the draft to `_hub/drafts/`, for a user who wants it filed. */
	proposal: Proposal | null;
	problem: string | null;
	refusals: Refusal[];
}

/**
 * Today's figures, from the log and the note.
 *
 * Inputs: the vault, index and day. Output: the facts. Side effects: reads.
 * Never reads a model, so the draft still has its clock line and its hours
 * when the CLI is unavailable.
 */
export async function gather(vault: Vault, index: NoteIndex, day: DayKey): Promise<DraftFacts> {
	const entries = await loadEntries(vault, [day]);
	const tasks = index.tasksIn(dailyNotePath(day)).filter((t) => !t.fenced);

	const starts = entries.map((e) => e.startMin).filter((m) => Number.isFinite(m));
	const ends = entries.map((e) => e.endMin).filter((m) => Number.isFinite(m));

	return {
		day,
		entries,
		finished: tasks.filter(isDone).map((t) => displayText(t.text)),
		planned: tasks.filter((t) => !isDone(t) && t.startMin !== null).map((t) => displayText(t.text)),
		firstMin: starts.length ? Math.min(...starts) : null,
		lastMin: ends.length ? Math.max(...ends) : null,
		loggedMinutes: entries.reduce((sum, e) => sum + e.minutes, 0)
	};
}

/**
 * The draft text, in the shape of the real files.
 *
 * `# DD/MM/YYYY`, a clock line, `## Tasks to do` and `## What's been done` as
 * `1)` items, and a `**BLOCKERS:**` line when there is one. Pure, so the
 * exact bytes are table-tested against the format the parser reads.
 *
 * Never numbers an empty section and never invents a clock time: a day with
 * no logged entries gets no clock line, because a guess at when someone
 * started work is the one thing in this document that must not be guessed.
 */
export function render(facts: DraftFacts, grouped: Grouped): string {
	const [y, m, d] = facts.day.split('-');
	const lines = [`# ${d}/${m}/${y}`];

	if (facts.firstMin !== null) lines.push(`${formatMinutes(facts.firstMin)} Start`);
	if (facts.lastMin !== null) lines.push(`${formatMinutes(facts.lastMin)} Leave`);

	const section = (heading: string, items: string[]): void => {
		if (items.length === 0) return;
		lines.push(heading);
		items.forEach((item, i) => lines.push(`${i + 1}) ${item}`));
	};

	section('## Tasks to do', grouped.todo);
	section("## What's been done", grouped.done);

	if (grouped.blockers?.trim()) lines.push(`**BLOCKERS:** ${grouped.blockers.trim()}`);
	if (facts.loggedMinutes > 0) lines.push(`## Timetracker`, `${formatDuration(facts.loggedMinutes)} logged`);

	return `${lines.join('\n')}\n`;
}

/**
 * Draft the day's timesheet entry.
 *
 * Inputs: the vault, index and day. Output the draft text, the facts behind
 * it, and an optional proposal that saves it under `_hub/drafts/`. Side
 * effects: spawns the CLI, appends to the audit log. Never writes any note,
 * and in particular never writes a `TIMESHEET` file.
 *
 * Never fails to produce a draft. A model that is unavailable, refused or
 * over budget costs the grouping and the phrasing; the day's own lines are
 * then used as written, which is worse prose and the same facts.
 */
export async function draft(
	vault: Vault,
	index: NoteIndex,
	day: DayKey,
	options: { cli?: Partial<CliDeps> } = {}
): Promise<TimesheetDraft> {
	const settings = await loadSettings(vault);
	const chosen = settings.features.timesheet;
	const startedAt = new Date().toISOString();
	const facts = await gather(vault, index, day);

	// What the draft says without a model: the log and the note, verbatim.
	const plain: Grouped = { todo: facts.planned, done: uniq([...facts.finished, ...facts.entries.map((e) => e.text)]) };

	const stop = checkKillSwitch(settings.enabled);
	if (stop.length) {
		return { day, text: render(facts, plain), facts, proposal: null, problem: stop[0].message, refusals: stop };
	}
	if (facts.entries.length === 0 && facts.finished.length === 0 && facts.planned.length === 0) {
		return { day, text: render(facts, plain), facts, proposal: null, problem: null, refusals: [] };
	}

	const spend = await spentOn(vault, day);
	const budget = checkBudget(chosen, { todayUsd: spend.usd, running: 0 }, settings.budget);
	const stamp: RunStamp = {
		...budget.settings,
		feature: 'timesheet',
		startedAt,
		durationMs: 0,
		costUsd: 0
	};

	let grouped = plain;
	let refusals = budget.refusals;
	if (budget.refusals.length === 0) {
		const result = await runClaude(
			{
				prompt: prompt(facts),
				settings: { ...budget.settings, permission: 'read-only' },
				systemPrompt:
					'You group one day of work into a timesheet entry. Answer only with JSON: ' +
					'{"todo":["…"],"done":["…"],"blockers":"…"}. Use the person\'s own words. ' +
					'Do not invent work. Do not mention hours; they are added separately.',
				jsonSchema: SCHEMA
			},
			options.cli
		);
		stamp.durationMs = result.durationMs;
		stamp.costUsd = result.ok ? result.costUsd : 0;
		if (result.ok) {
			const checked = validateModelOutput<Grouped>(result.json, SCHEMA);
			if (checked.ok) grouped = checked.value;
			else refusals = checked.refusals;
		} else {
			refusals = result.refusals;
		}
	}

	const text = render(facts, grouped);
	const proposal: Proposal = {
		id: newId('timesheet'),
		feature: 'timesheet',
		stamp,
		summary: `Timesheet draft for ${day}, saved to ${draftPath(day)}. Your timesheet is not touched.`,
		edits: [
			{
				id: newId('edit'),
				kind: 'create',
				path: draftPath(day),
				text,
				reason:
					'A scratch note, so the draft survives a page reload. The timesheet itself is shared at work and ' +
					'the app never writes to it; copy the text across yourself.'
			}
		],
		accepted: []
	};

	await logRun(vault, {
		at: startedAt,
		feature: 'timesheet',
		model: stamp.model,
		effort: stamp.effort,
		permission: stamp.permission,
		paths: [draftPath(day)],
		decision: 'proposed',
		guardrails: [...new Set(refusals.map((r) => r.guardrail))],
		costUsd: stamp.costUsd,
		durationMs: stamp.durationMs,
		note: proposal.summary
	});

	return { day, text, facts, proposal, problem: null, refusals };
}

function prompt(facts: DraftFacts): string {
	return [
		`One working day, ${facts.day}.`,
		'',
		'Time logged:',
		...facts.entries.map((e) => `- ${formatMinutes(e.startMin)}-${formatMinutes(e.endMin)} ${e.text}`),
		'',
		'Finished in the daily note:',
		...facts.finished.map((t) => `- ${t}`),
		'',
		'Planned but not finished:',
		...facts.planned.map((t) => `- ${t}`),
		'',
		'Group these into what is still to do and what was done. Merge duplicates.',
		'Put anything that reads like an obstacle into blockers.'
	].join('\n');
}

function uniq(items: string[]): string[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		const key = item.toLowerCase().trim();
		if (key === '' || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
