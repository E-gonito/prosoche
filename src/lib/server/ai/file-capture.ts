/**
 * Capture and file: deciding where a line in the Inbox belongs.
 *
 * The Inbox is one note with a bullet per thought, which is right for
 * capturing and useless for finding anything a fortnight later. This feature
 * reads the line, looks at what folders and workspaces exist, and proposes
 * two edits: append the line to the note it thinks it belongs in, and strike
 * it out of the Inbox where it came from.
 *
 * ## Why two edits and not a move
 *
 * A `move` renames a file, and the Inbox is one file holding thirty unrelated
 * lines. So the pair is an `append` plus a `rewrite-task`, which means the
 * user can accept the destination and decline the removal — useful, because
 * "file this but leave it in my inbox until I have dealt with it" is a real
 * thing to want and the proposal should not force the other half.
 *
 * The second edit is there only when the captured line is a task. Quick
 * capture keeps a line that already looks like a task as a task and turns
 * anything else into a plain `- 09:12 …` bullet, and there is no edit kind
 * that rewrites an arbitrary line — deliberately, because that is the widest
 * possible write. So a plain bullet is copied to its destination and left
 * where it is, and the proposal says so rather than quietly appearing to have
 * moved it.
 *
 * ## What the model is and is not asked
 *
 * It is asked for a destination and one sentence of reasoning, from a list of
 * paths it is given. It is not asked to write the line, because the line is
 * already written — the user wrote it — and rephrasing someone's own note is
 * both unnecessary and the sort of thing that quietly loses a detail. The
 * destination is then checked against that same list before becoming an edit,
 * so a model that invents `Work/Somewhere Nice.md` is refused by G6 and G4
 * rather than creating it.
 */

import { CAPTURE_PATH } from '../capture';
import { parseTaskLine } from '../parse/task';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';
import type { Workspace } from '../workspaces';
import { checkBudget, checkKillSwitch, validateModelOutput, wrapAsData, type Schema } from './guardrails';
import { newId } from './proposal';
import { loadSettings } from './settings';
import { logRun, spentOn } from './audit';
import { runClaude, type CliDeps } from './cli';
import type { GuardrailId, Proposal, ProposalEdit, Refusal, RunStamp } from '$lib/shared/ai';

/** What a model may answer. Unknown fields are refused, not ignored. */
const SCHEMA: Schema = {
	type: 'object',
	fields: {
		destination: { type: 'string', minLength: 1, maxLength: 300 },
		reason: { type: 'string', minLength: 1, maxLength: 400 }
	}
};

interface Choice {
	destination: string;
	reason: string;
}

export interface FileCaptureRequest {
	/** The captured line, as it stands in the Inbox note. */
	line: number;
	/** What the browser last saw on that line, so a stale page is refused. */
	expectedRaw: string;
	/** Overrides the Inbox, for a capture filed from somewhere else. */
	path?: string;
}

export interface FileCaptureResult {
	proposal: Proposal | null;
	/** The candidate destinations the model was given, for the empty case. */
	candidates: string[];
	problem: string | null;
	refusals: Refusal[];
}

/**
 * Propose where one captured line should go.
 *
 * Inputs: the vault, index and workspaces, and which line to file. Output a
 * proposal of at most two edits, or a problem. Side effects: spawns the CLI,
 * appends to the audit log. Never writes a note.
 *
 * Never proposes a destination that was not in the list it offered, and never
 * proposes the Inbox itself. A vault with no candidate notes comes back with
 * an empty `candidates` and no proposal, because "file this somewhere" has no
 * answer when there is nowhere.
 */
export async function fileCapture(
	deps: { vault: Vault; index: NoteIndex; workspaces: Workspace[] },
	request: FileCaptureRequest,
	options: { cli?: Partial<CliDeps> } = {}
): Promise<FileCaptureResult> {
	const source = request.path ?? CAPTURE_PATH;
	const settings = await loadSettings(deps.vault);
	const chosen = settings.features.capture;
	const startedAt = new Date().toISOString();

	const stop = checkKillSwitch(settings.enabled);
	if (stop.length) return { proposal: null, candidates: [], problem: stop[0].message, refusals: stop };

	const task = deps.index.tasksIn(source).find((t) => t.line === request.line);
	const raw = task?.raw ?? (await lineOf(deps.vault, source, request.line));
	if (raw === null) {
		return { proposal: null, candidates: [], problem: 'That line is no longer in the note.', refusals: [] };
	}
	if (raw !== request.expectedRaw) {
		return {
			proposal: null,
			candidates: [],
			problem: 'That line has changed since the page loaded. Reload and try again.',
			refusals: []
		};
	}

	const candidates = destinations(deps, source);
	if (candidates.length === 0) {
		return { proposal: null, candidates, problem: null, refusals: [] };
	}

	const spend = await spentOn(deps.vault, startedAt.slice(0, 10));
	const budget = checkBudget(chosen, { todayUsd: spend.usd, running: 0 }, settings.budget);
	if (budget.refusals.length) {
		return { proposal: null, candidates, problem: budget.refusals[0].message, refusals: budget.refusals };
	}

	const result = await runClaude(
		{
			prompt: prompt(raw, candidates, deps.workspaces),
			settings: { ...budget.settings, permission: 'read-only' },
			systemPrompt:
				'You choose where one captured note belongs. Answer only with JSON: ' +
				'{"destination": "<one path from the list, exactly as written>", "reason": "<one sentence>"}. ' +
				'Never invent a path. Never rewrite the note text.',
			jsonSchema: SCHEMA
		},
		options.cli
	);

	const stamp: RunStamp = {
		...budget.settings,
		feature: 'capture',
		startedAt,
		durationMs: result.durationMs,
		costUsd: result.ok ? result.costUsd : 0
	};

	const log = (decision: 'proposed' | 'refused' | 'failed', note: string, guardrails: GuardrailId[] = []) =>
		logRun(deps.vault, {
			at: startedAt,
			feature: 'capture',
			model: stamp.model,
			effort: stamp.effort,
			permission: stamp.permission,
			paths: [source],
			decision,
			guardrails,
			costUsd: stamp.costUsd,
			durationMs: stamp.durationMs,
			note
		});

	if (!result.ok) {
		await log(result.reason === 'refused' ? 'refused' : 'failed', result.message, result.refusals.map((r) => r.guardrail));
		return { proposal: null, candidates, problem: result.message, refusals: result.refusals };
	}

	const checked = validateModelOutput<Choice>(result.json, SCHEMA);
	if (!checked.ok) {
		await log('refused', 'model output did not match the schema', ['G6']);
		return { proposal: null, candidates, problem: checked.refusals[0].message, refusals: checked.refusals };
	}

	// The destination must be one this run offered. Checked here as well as by
	// G4, because G4 knows what a feature may write and this knows what this
	// particular question was about.
	if (!candidates.includes(checked.value.destination)) {
		await log('refused', `chose a path that was not offered: ${checked.value.destination}`, ['G6']);
		return {
			proposal: null,
			candidates,
			problem: `It chose ${checked.value.destination}, which was not one of the options.`,
			refusals: []
		};
	}

	const proposal = propose(source, raw, request.line, checked.value, stamp);
	await log('proposed', proposal.summary);
	return { proposal, candidates, problem: null, refusals: [] };
}

/**
 * The two edits, given a decision. Pure, so the exact shape is table-tested.
 *
 * The append carries the line verbatim. The removal is a `rewrite-task`
 * marking it cancelled rather than deleting it, because a line struck through
 * in the Inbox is a record that it was filed, and deleting it would make an
 * accepted proposal indistinguishable from one that never ran.
 */
export function propose(
	source: string,
	raw: string,
	line: number,
	choice: Choice,
	stamp: RunStamp
): Proposal {
	const text = raw.replace(/^[-*+]\s+(\[.\]\s+)?(\d{2}:\d{2}\s+)?/, '').trim();
	const isTask = parseTaskLine(raw) !== null;

	const edits: ProposalEdit[] = [
		{
			id: newId('edit'),
			kind: 'append',
			path: choice.destination,
			text: `- ${text}\n`,
			reason: choice.reason
		}
	];

	if (isTask) {
		edits.push({
			id: newId('edit'),
			kind: 'rewrite-task',
			path: source,
			line,
			expectedRaw: raw,
			edit: { status: 'cancelled' },
			reason: `Struck out in the Inbox, now that it lives in ${choice.destination}. Decline this to keep it in both.`
		});
	}

	return {
		id: newId('capture'),
		feature: 'capture',
		stamp,
		summary: isTask
			? `File “${text.slice(0, 60)}” into ${choice.destination} and strike it out of the Inbox.`
			: `Copy “${text.slice(0, 60)}” into ${choice.destination}. It stays in the Inbox; this app only rewrites task lines.`,
		edits,
		accepted: []
	};
}

/**
 * Notes this line could plausibly be filed into.
 *
 * Every workspace's folders, plus the folders that already hold notes, and
 * never the note the line came from. Capped, because a prompt listing three
 * hundred paths costs more than it helps and the last hundred are never
 * chosen anyway.
 */
export function destinations(
	deps: { index: NoteIndex; workspaces: Workspace[] },
	source: string
): string[] {
	const folders = deps.workspaces.flatMap((w) => w.folders ?? []);
	const under = folders.length ? folders : undefined;
	return deps.index
		.notes({ under, excludePrefixes: ['_hub/', 'Journal/'], limit: 120 })
		.map((n) => n.path)
		.filter((p) => p !== source);
}

function prompt(raw: string, candidates: string[], workspaces: Workspace[]): string {
	return [
		'A line captured into someone\'s inbox:',
		'',
		wrapAsData([{ path: 'Inbox', text: raw }]),
		'',
		'Their workspaces:',
		...workspaces.map((w) => `- ${w.name}: ${(w.folders ?? []).join(', ') || 'no folders'}`),
		'',
		'Choose the note it belongs in, from these and only these:',
		...candidates.map((p) => `- ${p}`)
	].join('\n');
}

/** The raw text of a line, for a note whose lines are not tasks. */
async function lineOf(vault: Vault, path: string, line: number): Promise<string | null> {
	const note = await vault.read(path);
	if (!note.exists) return null;
	return note.content.split('\n')[line] ?? null;
}
