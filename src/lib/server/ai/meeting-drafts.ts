/**
 * What Claude drafts for a meeting notebook: the primer and talking points
 * for a meeting. Glossary drafts are in `glossary-drafts.ts`, and share the
 * plumbing at the foot of this file.
 *
 * Each draft is a proposal and nothing more. The model is given the
 * workspace's notes as data (G8), answers in a fixed JSON shape (G6), and the
 * bytes it would change are computed here from that answer and the note as
 * it stands. Nothing in this file writes to the vault; `proposal.apply` does,
 * after a human accepts, under the path policy `policyFor` gives each
 * feature: exactly one primer or one meeting note.
 *
 * The prompt builders and proposal builders are pure and exported, because
 * they are the part worth testing: what the model is told, and what an
 * answer turns into.
 */

import type { Vault } from '../vault/index';
import type { Workspace } from '../workspaces';
import type { CalendarEvent } from '../calendar';
import { appendUnderHeading } from '../sections';
import { formatMinutes } from '../daily';
import { TALKING_POINTS_HEADING, meetingPath, newMeetingNote } from '../parse/meeting';
import { currentMeeting, isMeetingNote, loadMeetings, notebookPaths, openActions, type Meeting } from '../meetings';
import { glossaryOf } from '../glossary';
import { checkBudget, checkKillSwitch, validateModelOutput, wrapAsData, type Schema } from './guardrails';
import { newId } from './proposal';
import { loadSettings } from './settings';
import { logRun, spentOn } from './audit';
import { runClaude, type CliDeps } from './cli';
import type { FeatureId, GuardrailId, Proposal, Refusal, RunStamp } from '$lib/shared/ai';

/** What every draft returns: a proposal, or why there is none. */
export interface DraftResult {
	proposal: Proposal | null;
	problem: string | null;
	refusals: Refusal[];
	/** The one path the proposal may write, for the per-run path policy. */
	destinations: string[];
}

export interface DraftOptions {
	cli?: Partial<CliDeps>;
}

/** A passage of the user's notes, for `wrapAsData`. */
export interface Source {
	path: string;
	text: string;
}

/** How much of any one note goes into a prompt. */
export const NOTE_CHARS = 8000;

/* ------------------------------------------------------------- primer -- */

const PRIMER_SCHEMA: Schema = {
	type: 'object',
	fields: { primer: { type: 'string', minLength: 20, maxLength: 30000 } }
};

/**
 * The prompt for a primer. Pure.
 *
 * Asks for the shape the meeting card draws: a lead paragraph, one sand
 * callout, `##` sections of facts with a line on why each matters. With a
 * current primer it asks for a revision of that text, not a fresh one, so
 * the user's own wording survives where it still holds.
 */
export function primerPrompt(input: { workspace: string; current: string | null; sources: Source[] }): string {
	const task = input.current
		? [
				`Revise the meeting primer for the "${input.workspace}" workspace, which is the first passage below.`,
				'Keep what is still true and the user\'s own wording where it works; update what the notes show has changed;',
				'add what is missing. Return the whole revised primer, not a list of changes.'
			]
		: [`Write a meeting primer for the "${input.workspace}" workspace from the notes below.`];
	return [
		...task,
		'A primer is the one-page card the user reads before walking into a meeting. Its shape, in markdown:',
		'- An opening paragraph whose first sentence is bold: what the user\'s job in the room is.',
		'- One blockquote with a bold lead-in for the single most important caution, e.g. "> **Rate limit:** …".',
		'- Then `##` sections. Facts go in a bullet list: one fact per bullet, with an indented sub-bullet on why it matters here.',
		'  Principles go in a numbered list, each a bold title and a sentence. End with question stems the user can read off the page.',
		'- No `#` title. Specific to this workspace. Claim nothing the notes do not support. Under 700 words.',
		'',
		wrapAsData(input.current ? [{ path: 'Primer.md (current)', text: input.current }, ...input.sources] : input.sources)
	].join('\n');
}

/**
 * The primer as a proposal. Pure: a `create` when there is no primer yet, a
 * `revise` pinned to the hash that was read when there is.
 */
export function primerProposal(
	path: string,
	current: { exists: boolean; hash: string },
	text: string,
	stamp: RunStamp
): Proposal {
	const body = `${text.replace(/\r/g, '').trim()}\n`;
	const edit = current.exists
		? { id: newId('edit'), kind: 'revise' as const, path, text: body, expectedHash: current.hash, reason: 'A revised primer, drafted from the workspace\'s latest notes.' }
		: { id: newId('edit'), kind: 'create' as const, path, text: body, reason: 'A first primer, drafted from the workspace\'s notes.' };
	return {
		id: newId('primer'),
		feature: 'primer-draft',
		stamp,
		summary: current.exists ? `Suggested updates to ${path}.` : `A primer for ${path}.`,
		edits: [edit],
		accepted: []
	};
}

/**
 * Draft or revise a workspace's `Primer.md` from its log, recent meeting
 * notes and workspace file. Side effects: spawns the CLI, appends to the
 * audit log. Never writes a note.
 */
export async function draftPrimer(vault: Vault, workspace: Workspace, options: DraftOptions = {}): Promise<DraftResult> {
	const paths = notebookPaths(workspace);
	if (!paths) return nothing('This workspace has no meeting notebook to keep a primer in.');
	const destinations = [paths.primer];

	const current = await vault.read(paths.primer);
	const meetings = await loadMeetings(vault, paths);
	const glossary = await glossaryOf(vault, workspace);
	const sources = await gather(vault, [workspace.path, paths.log, ...(glossary ? [glossary.path] : [])]);
	sources.push(...meetings.slice(0, 5).map(asSource));

	const run = await runDraft<{ primer: string }>(vault, {
		feature: 'primer-draft',
		prompt: primerPrompt({ workspace: workspace.name, current: current.exists ? current.content : null, sources }),
		system: 'You write meeting primers from one person\'s notes. Answer only with JSON: {"primer":"<markdown>"}.',
		schema: PRIMER_SCHEMA,
		paths: [paths.primer],
		cli: options.cli
	});
	if (!run.ok) return { ...run.result, destinations };
	return { proposal: primerProposal(paths.primer, current, run.value.primer, run.stamp), problem: null, refusals: [], destinations };
}

/* --------------------------------------------------------------- prep -- */

const PREP_SCHEMA: Schema = {
	type: 'object',
	fields: { points: { type: 'array', maxItems: 8, of: { type: 'string', minLength: 3, maxLength: 400 } } }
};

/** The meeting a prep is for, as the prompt describes it. */
export interface PrepMeeting {
	title: string;
	day: string | null;
	startMin: number | null;
	attendees: string[];
}

/**
 * The prompt for talking points. Pure. Open actions are listed in the prompt
 * itself because they are short and the point of the exercise; the primer
 * and past meetings go in as data.
 */
export function prepPrompt(input: { workspace: string; meeting: PrepMeeting; actions: string[]; sources: Source[] }): string {
	const when = [input.meeting.day, input.meeting.startMin !== null ? formatMinutes(input.meeting.startMin) : null].filter(Boolean).join(' ');
	return [
		`Draft talking points for the user's next meeting in the "${input.workspace}" workspace.`,
		`Meeting: ${input.meeting.title}${when ? `, ${when}` : ''}.`,
		input.meeting.attendees.length ? `Attendees: ${input.meeting.attendees.join(', ')}.` : 'Attendees: not known.',
		input.actions.length ? `Open actions from earlier meetings:\n${input.actions.map((a) => `- ${a}`).join('\n')}` : 'No open actions.',
		'',
		'Write three to six talking points: follow-ups on open actions, decisions to confirm, and questions phrased',
		'as a hypothesis to correct ("My model is that X. Is that right?"). One line each, no leading dash.',
		'Ground every point in the notes; invent nothing.',
		'',
		wrapAsData(input.sources)
	].join('\n');
}

/**
 * Talking points as a proposal. Pure.
 *
 * With a meeting note to add to: an `append` of a new `## Talking points`
 * section, or, when the note has one already, a `revise` that inserts the
 * points under it. With none: a `create` of the meeting note itself, points
 * above Captured, so accepting the prep also starts the note.
 */
export function prepProposal(
	target: { path: string; note: { content: string; hash: string } | null; meeting: PrepMeeting & { type?: 'meeting' | 'standup'; event?: string | null } },
	points: string[],
	stamp: RunStamp
): Proposal {
	const clean = points.map((p) => p.replace(/\s+/g, ' ').replace(/^[-*]\s+/, '').trim()).filter(Boolean);
	const reason = 'Talking points drafted from the primer, recent meetings and open actions.';
	let edit: Proposal['edits'][number];
	if (!target.note) {
		const text = newMeetingNote({
			type: target.meeting.type ?? 'meeting',
			date: target.meeting.day ?? '',
			title: target.meeting.title,
			event: target.meeting.event ?? null,
			attendees: target.meeting.attendees,
			talkingPoints: clean
		});
		edit = { id: newId('edit'), kind: 'create', path: target.path, text, reason: `${reason} Accepting starts the meeting note.` };
	} else if (hasHeading(target.note.content, TALKING_POINTS_HEADING)) {
		let text = target.note.content;
		for (const point of clean) text = appendUnderHeading(text, TALKING_POINTS_HEADING, `- ${point}`).content;
		edit = { id: newId('edit'), kind: 'revise', path: target.path, text, expectedHash: target.note.hash, reason };
	} else {
		const text = `\n${TALKING_POINTS_HEADING}\n${clean.map((p) => `- ${p}`).join('\n')}\n`;
		edit = { id: newId('edit'), kind: 'append', path: target.path, text, reason };
	}
	return {
		id: newId('prep'),
		feature: 'meeting-prep',
		stamp,
		summary: `${clean.length} talking point${clean.length === 1 ? '' : 's'} for ${target.meeting.title}.`,
		edits: [edit],
		accepted: []
	};
}

/**
 * Draft talking points for the current meeting, or for a new one called
 * `title` when none is under way. Reads the primer, the last three other
 * meetings, open actions and the calendar event when there is one. Never
 * writes a note.
 */
export async function draftPrep(
	vault: Vault,
	workspace: Workspace,
	input: { title: string; today: string; event: CalendarEvent | null },
	options: DraftOptions = {}
): Promise<DraftResult> {
	const paths = notebookPaths(workspace);
	if (!paths) return nothing('This workspace has no meeting notebook.');

	const meetings = await loadMeetings(vault, paths);
	const current = currentMeeting(meetings, input.today);
	const title = current?.title ?? (input.title.trim() || input.event?.title || 'Meeting');
	const day = current?.date ?? input.event?.day ?? input.today;
	const path = current?.path ?? meetingPath(paths.meetings, day, title, meetings.map((m) => m.path));
	if (!isMeetingNote(paths, path)) return nothing('That meeting has nowhere to go.');

	const meeting: PrepMeeting & { event: string | null } = {
		title,
		day,
		startMin: input.event?.startMin ?? null,
		attendees: current?.attendees.length ? current.attendees : (input.event?.attendees ?? []),
		event: current?.event ?? input.event?.id ?? null
	};
	const actions = openActions(meetings).map((a) => `${a.text} (from ${a.source.title}${a.source.date ? ` ${a.source.date}` : ''})`);
	const sources = await gather(vault, [paths.primer]);
	sources.push(...meetings.filter((m) => m.path !== current?.path).slice(0, 3).map(asSource));

	const run = await runDraft<{ points: string[] }>(vault, {
		feature: 'meeting-prep',
		prompt: prepPrompt({ workspace: workspace.name, meeting, actions, sources }),
		system: 'You prepare one person for a meeting from their notes. Answer only with JSON: {"points":["…"]}.',
		schema: PREP_SCHEMA,
		paths: [path],
		cli: options.cli
	});
	const destinations = [path];
	if (!run.ok) return { ...run.result, destinations };
	if (run.value.points.length === 0) return { ...nothing(null), destinations };
	const note = current ? { content: current.content, hash: current.hash } : null;
	return { proposal: prepProposal({ path, note, meeting }, run.value.points, run.stamp), problem: null, refusals: [], destinations };
}

/* ------------------------------------------------------------- plumbing -- */

/** A draft result with no proposal, saying why (or null for "nothing to do"). Pure. */
export function nothing(problem: string | null): DraftResult {
	return { proposal: null, problem, refusals: [], destinations: [] };
}

function hasHeading(content: string, heading: string): boolean {
	return content.split('\n').some((l) => l.trim().toLowerCase() === heading.toLowerCase());
}

/** A meeting note as a prompt passage, its first `NOTE_CHARS`. Pure. */
export function asSource(meeting: Meeting): Source {
	return { path: meeting.path, text: meeting.content.slice(0, NOTE_CHARS) };
}

/**
 * The notes that exist and are not blank among `paths`, each trimmed to its
 * last `NOTE_CHARS` for a prompt. Reads only; a missing note is skipped.
 */
export async function gather(vault: Vault, paths: string[]): Promise<Source[]> {
	const out: Source[] = [];
	for (const path of paths) {
		const note = await vault.read(path);
		if (note.exists && note.content.trim()) out.push({ path, text: note.content.slice(-NOTE_CHARS) });
	}
	return out;
}

/**
 * One read-only CLI run, checked and logged: kill switch (G10), budget (G7),
 * schema (G6). Returns the validated answer and the stamp, or the draft
 * result to hand back when there is none. Side effects: spawns the CLI with
 * the feature's model settings, appends to the audit log. Never writes a
 * note.
 */
export async function runDraft<T>(
	vault: Vault,
	input: { feature: FeatureId; prompt: string; system: string; schema: Schema; paths: string[]; cli?: Partial<CliDeps> }
): Promise<{ ok: true; value: T; stamp: RunStamp } | { ok: false; result: DraftResult }> {
	const settings = await loadSettings(vault);
	const chosen = settings.features[input.feature];
	const startedAt = new Date().toISOString();
	const fail = (problem: string, refusals: Refusal[]) => ({ ok: false as const, result: { ...nothing(problem), refusals } });

	const stop = checkKillSwitch(settings.enabled);
	if (stop.length) return fail(stop[0].message, stop);

	const spend = await spentOn(vault, startedAt.slice(0, 10));
	const budget = checkBudget(chosen, { todayUsd: spend.usd, running: 0 }, settings.budget);
	if (budget.refusals.length) return fail(budget.refusals[0].message, budget.refusals);

	const result = await runClaude(
		{ prompt: input.prompt, settings: { ...budget.settings, permission: 'read-only' }, systemPrompt: input.system, jsonSchema: input.schema },
		input.cli
	);
	const stamp: RunStamp = {
		...budget.settings,
		feature: input.feature,
		startedAt,
		durationMs: result.durationMs,
		costUsd: result.ok ? result.costUsd : 0
	};
	const log = (decision: 'proposed' | 'refused' | 'failed', note: string, guardrails: GuardrailId[] = []) =>
		logRun(vault, {
			at: startedAt,
			feature: input.feature,
			model: stamp.model,
			effort: stamp.effort,
			permission: stamp.permission,
			paths: input.paths,
			decision,
			guardrails,
			costUsd: stamp.costUsd,
			durationMs: stamp.durationMs,
			note
		});

	if (!result.ok) {
		await log(result.reason === 'refused' ? 'refused' : 'failed', result.message, result.refusals.map((r) => r.guardrail));
		return fail(result.message, result.refusals);
	}
	const checked = validateModelOutput<T>(result.json, input.schema);
	if (!checked.ok) {
		await log('refused', 'model output did not match the schema', ['G6']);
		return fail(checked.refusals[0].message, checked.refusals);
	}
	await log('proposed', `${input.feature} drafted`);
	return { ok: true, value: checked.value, stamp };
}
