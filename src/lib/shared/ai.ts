/**
 * What the AI layer is, known to both sides.
 *
 * Everything here is data or a pure function, so a Svelte component can show
 * a model picker, a guardrail refusal or a diff without dragging the server
 * modules — and therefore the filesystem and the `claude` CLI — into the
 * browser bundle. The rules themselves live in `$server/ai/guardrails`; this
 * file only names them.
 */

/** One entry in the model picker. */
export interface ModelOption {
	id: string;
	label: string;
	hint: string;
}

/**
 * The models this version knows, for when Claude Code's own catalog cannot be
 * read. The picker normally offers that catalog instead (`ai/models.ts`), so
 * a model released after this list was written shows up without a code
 * change.
 *
 * Written out rather than using the CLI's `opus`/`sonnet` aliases, because a
 * run is stamped with what produced it and "sonnet" stops meaning anything
 * once the alias moves.
 */
export const SHIPPED_MODELS: readonly ModelOption[] = [
	{ id: 'claude-opus-5-5', label: 'Opus 5.5', hint: 'The newest Opus. Deep reasoning; slow and dear.' },
	{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', hint: 'The default. Good at everything.' },
	{ id: 'claude-fable-5-1', label: 'Fable 5.1', hint: 'Design review and hard debugging.' },
	{ id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', hint: 'Fast and cheap. Triage and sorting.' },
	{ id: 'claude-opus-5', label: 'Opus 5', hint: 'The previous Opus.' },
	{ id: 'claude-sonnet-5', label: 'Sonnet 5', hint: 'The previous Sonnet.' }
];

/**
 * A model id. A plain string, because the ids on offer are read at run time;
 * `loadSettings` only ever hands out one that was on offer.
 */
export type Model = string;

export const EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
export type Effort = (typeof EFFORTS)[number];

export type FeatureId =
	| 'briefing'
	| 'glossary-lookup'
	| 'glossary-scan'
	| 'dating-insights';

/**
 * The two controls the user picks, plus the two limits that bound a run.
 *
 * There is no permission mode. Every run is read-only: the model gets no
 * tools and the server puts the notes in the prompt (G2). A mode that could
 * be switched would be a guardrail someone could switch off.
 */
export interface RunSettings {
	model: Model;
	effort: Effort;
	/** Hard cap for this run, in US dollars. */
	budgetUsd: number;
	/** Wall-clock limit. The server kills the process at this point. */
	timeoutSeconds: number;
}

/** What produced a result, shown beside it so a bad answer can be attributed. */
export interface RunStamp extends RunSettings {
	feature: FeatureId;
	startedAt: string;
	durationMs: number;
	costUsd: number;
}

/**
 * Per-feature defaults, from SPEC 7.3.
 *
 * Shared rather than server-only because the settings page and the per-run row
 * both need to show "what you would get if you changed nothing", and two
 * copies of this table would drift.
 */
export const FEATURE_DEFAULTS: Record<FeatureId, RunSettings> = {
	briefing: { model: 'claude-sonnet-5-5', effort: 'medium', budgetUsd: 0.25, timeoutSeconds: 120 },
	'glossary-lookup': { model: 'claude-sonnet-5-5', effort: 'medium', budgetUsd: 0.5, timeoutSeconds: 180 },
	// Per batch: up to 60,000 characters of notes in, up to 25 entries out.
	'glossary-scan': { model: 'claude-sonnet-5-5', effort: 'medium', budgetUsd: 0.5, timeoutSeconds: 240 },
	// Kept low because a read on a private log is a small, occasional ask.
	'dating-insights': { model: 'claude-sonnet-5-5', effort: 'low', budgetUsd: 0.15, timeoutSeconds: 90 }
};

export const FEATURE_LABELS: Record<FeatureId, string> = {
	briefing: 'Morning briefing',
	'glossary-lookup': 'Glossary look-up',
	'glossary-scan': 'Glossary scan',
	'dating-insights': 'Dating insights'
};

/** The caps G7 enforces, whatever an individual feature's row asks for. */
export interface BudgetLimits {
	dailyUsd: number;
	maxTimeoutSeconds: number;
	maxRunUsd: number;
}

/** The part of G5 a user may tune. The rest of it is not negotiable. */
export interface BlastCaps {
	maxFiles: number;
	/** Fraction of a file's lines that may disappear, 0 to 1. */
	maxLineLoss: number;
}

/**
 * Everything in `_hub/ai.md`, as both sides see it.
 *
 * Shared rather than server-only because the settings page is a form over
 * exactly this object, and a second browser-shaped copy of it would be one
 * more thing to keep in step.
 */
export interface AiSettings {
	/** G10. False disables every AI surface and every scheduled job. */
	enabled: boolean;
	budget: BudgetLimits;
	blast: BlastCaps;
	features: Record<FeatureId, RunSettings>;
}

/**
 * The guardrails of SPEC 7.2, by the number the spec gives them. There are
 * nine: G3, "sandbox for tool runs", went with the tool runs, and what was
 * left of it (the CLI never runs inside the vault) is part of G2. The
 * numbers are kept because the audit log already quotes them.
 */
export type GuardrailId = 'G1' | 'G2' | 'G4' | 'G5' | 'G6' | 'G7' | 'G8' | 'G9' | 'G10';

export const GUARDRAILS: Record<GuardrailId, string> = {
	G1: 'No direct writes',
	G2: 'Read-only, always',
	G4: 'Path policy',
	G5: 'Blast radius',
	G6: 'Schema validation',
	G7: 'Budget and time',
	G8: 'Prompt injection',
	G9: 'Audit and undo',
	G10: 'Kill switch'
};

/** Why something was not done, naming the guardrail so it is arguable. */
export interface Refusal {
	guardrail: GuardrailId;
	/** The guardrail's name, carried along so the UI needs no lookup table. */
	title: string;
	message: string;
	/** The path at fault, when one edit caused it. */
	path?: string;
}

export function refuse(guardrail: GuardrailId, message: string, path?: string): Refusal {
	return path === undefined
		? { guardrail, title: GUARDRAILS[guardrail], message }
		: { guardrail, title: GUARDRAILS[guardrail], message, path };
}

/**
 * One concrete change, as an intention rather than as bytes.
 *
 * The kinds are a closed set on purpose: the guardrails need to reason about
 * what a change *means* ("is this a deletion?", "is this a whole-note
 * rewrite?"), and a bag of character offsets cannot answer that. The bytes are
 * computed from the intention by our own code, never by the model, which is
 * also why there is no `delete` kind — nothing in this phase removes a file.
 * Each kind exists because a feature produces it: the briefing appends its
 * markers and then replaces the region between them, and a glossary look-up
 * revises its glossary.
 */
export type ProposalEdit =
	| { id: string; kind: 'append'; path: string; text: string; reason: string }
	| { id: string; kind: 'replace-region'; path: string; marker: string; text: string; reason: string }
	/**
	 * A whole new version of an existing note, for a revision a human reads
	 * as a diff: a glossary with definitions filled in. `expectedHash` is the note as the draft read it, so a note
	 * edited since is refused rather than overwritten; G5's line-loss cap
	 * still applies to the result.
	 */
	| { id: string; kind: 'revise'; path: string; text: string; expectedHash: string; reason: string };

type EditKind = ProposalEdit['kind'];

export const EDIT_KIND_LABELS: Record<EditKind, string> = {
	append: 'Append',
	'replace-region': 'Replace marker region',
	revise: 'Revise note'
};

/**
 * A model's answer expressed as changes a human can accept or throw away.
 *
 * `accepted` is a list of edit ids rather than a boolean, because a review
 * where the only options are "all of it" or "none of it" pushes people into
 * accepting the one wrong line along with the four right ones.
 */
export interface Proposal {
	id: string;
	feature: FeatureId;
	stamp: RunStamp;
	summary: string;
	edits: ProposalEdit[];
	/** Edit ids the human ticked. Empty until they do. */
	accepted: string[];
}

/** One edit with the bytes it would produce, for the diff view. */
export interface EditPreview {
	id: string;
	kind: EditKind;
	path: string;
	reason: string;
	before: string;
	after: string;
	/** Empty when this edit passed every guardrail. */
	refusals: Refusal[];
}

/**
 * The result of running the guardrails over a proposal.
 *
 * `ok: false` still carries the previews, because a refused proposal is worth
 * showing: the user wants to see what the model wanted to do and why it was
 * stopped, not a bare error.
 */
export type Validation =
	| { ok: true; proposal: Proposal; previews: EditPreview[] }
	| { ok: false; refusals: Refusal[]; previews: EditPreview[] };

/** What was written, after a human accepted it. */
export interface ApplyResult {
	/** Paths actually written, in order. Empty when nothing was applied. */
	written: string[];
	/** Edits that were accepted but could not be applied. */
	refusals: Refusal[];
	/** Where the affected files were snapshotted, for undo. */
	undoId: string | null;
}

type DiffRow = { kind: 'same' | 'add' | 'remove'; text: string; line: number };

/**
 * Line diff of two versions of a file, for the review view.
 *
 * Pure, and in the shared module, because the diff is shown in the browser
 * and computing it on the server would mean sending both whole files twice.
 * Identical head and tail are trimmed before the quadratic part runs, so a
 * one-line change in a long note costs nothing.
 */
export function diffLines(before: string, after: string): DiffRow[] {
	const a = before === '' ? [] : before.split('\n');
	const b = after === '' ? [] : after.split('\n');

	let head = 0;
	while (head < a.length && head < b.length && a[head] === b[head]) head++;
	let tail = 0;
	while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

	const rows: DiffRow[] = [];
	for (let i = 0; i < head; i++) rows.push({ kind: 'same', text: a[i], line: i + 1 });

	const midA = a.slice(head, a.length - tail);
	const midB = b.slice(head, b.length - tail);
	for (const row of diffMiddle(midA, midB, head)) rows.push(row);

	for (let i = 0; i < tail; i++) {
		const index = a.length - tail + i;
		rows.push({ kind: 'same', text: a[index], line: index + 1 });
	}
	return rows;
}

/**
 * Longest-common-subsequence diff of the parts that actually differ. Falls
 * back to "delete everything, add everything" past a size where the table
 * would cost more than the review is worth.
 */
function diffMiddle(a: string[], b: string[], offset: number): DiffRow[] {
	const rows: DiffRow[] = [];
	if (a.length === 0 && b.length === 0) return rows;
	if (a.length * b.length > 1_000_000) {
		a.forEach((text, i) => rows.push({ kind: 'remove', text, line: offset + i + 1 }));
		b.forEach((text, i) => rows.push({ kind: 'add', text, line: offset + i + 1 }));
		return rows;
	}

	const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}

	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			rows.push({ kind: 'same', text: a[i], line: offset + i + 1 });
			i++;
			j++;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
			rows.push({ kind: 'remove', text: a[i], line: offset + i + 1 });
			i++;
		} else {
			rows.push({ kind: 'add', text: b[j], line: offset + j + 1 });
			j++;
		}
	}
	while (i < a.length) rows.push({ kind: 'remove', text: a[i], line: offset + ++i });
	while (j < b.length) rows.push({ kind: 'add', text: b[j], line: offset + ++j });
	return rows;
}

/** How many lines the change removes and adds, for the blast-radius check. */
export function changedLines(before: string, after: string): { removed: number; added: number; of: number } {
	const rows = diffLines(before, after);
	return {
		removed: rows.filter((r) => r.kind === 'remove').length,
		added: rows.filter((r) => r.kind === 'add').length,
		of: before === '' ? 0 : before.split('\n').length
	};
}

/**
 * What every drafting feature returns: the briefing and the glossary look-up.
 *
 * Here rather than beside the runner because the browser shows this and a
 * component may not import from `$server`. `proposal` waits for a human to
 * accept it, or is null with `problem` saying why (null for "nothing to do").
 * `destinations` are the paths the proposal may write, which the browser
 * passes back to `/api/ai/proposal` for the per-run path policy.
 */
export interface DraftResult {
	proposal: Proposal | null;
	problem: string | null;
	refusals: Refusal[];
	destinations: string[];
}
