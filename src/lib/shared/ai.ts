/**
 * What the AI layer is, known to both sides.
 *
 * Everything here is data or a pure function, so a Svelte component can show
 * a model picker, a guardrail refusal or a diff without dragging the server
 * modules — and therefore the filesystem and the `claude` CLI — into the
 * browser bundle. The rules themselves live in `$server/ai/guardrails`; this
 * file only names them.
 */

/**
 * Model ids the picker offers.
 *
 * Written out rather than using the CLI's `opus`/`sonnet` aliases, because a
 * run is stamped with what produced it and "sonnet" stops meaning anything
 * once the alias moves.
 */
export const MODELS = [
	{ id: 'claude-opus-5-5', label: 'Opus 5.5', hint: 'The newest Opus. Deep reasoning; slow and dear.' },
	{ id: 'claude-opus-5', label: 'Opus 5', hint: 'The previous Opus. Deep reasoning; slow and dear.' },
	{ id: 'claude-sonnet-5', label: 'Sonnet 5', hint: 'The default. Good at everything.' },
	{ id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', hint: 'Fast and cheap. Triage and sorting.' },
	{ id: 'claude-fable-5-1', label: 'Fable 5.1', hint: 'Design review and hard debugging.' }
] as const;

export type Model = (typeof MODELS)[number]['id'];

export const EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
export type Effort = (typeof EFFORTS)[number];

/**
 * How much the run is allowed to do.
 *
 * There is deliberately no fourth mode. A "bypass everything" option would be
 * one mis-click away from a language model with write access to the vault, so
 * the type system does not admit one and `guardrails.toolPolicyFor` has no
 * branch that could produce one.
 */
export const PERMISSION_MODES = [
	{ id: 'read-only', label: 'Read only', hint: 'No tools. The server supplies the notes.' },
	{ id: 'propose', label: 'Propose', hint: 'Tools inside a sandbox copy. Comes back as a diff.' },
	{ id: 'apply', label: 'Propose, one-click accept', hint: 'Same sandbox. Accept is still a click.' }
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number]['id'];

export type FeatureId =
	| 'ask'
	| 'insights'
	| 'briefing'
	| 'weekly-review'
	| 'capture'
	| 'suggest-flashcards'
	| 'timesheet';

/** The four controls the user picks, plus the two limits that bound a run. */
export interface RunSettings {
	model: Model;
	effort: Effort;
	permission: PermissionMode;
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
	ask: { model: 'claude-sonnet-5', effort: 'medium', permission: 'read-only', budgetUsd: 0.25, timeoutSeconds: 90 },
	insights: { model: 'claude-sonnet-5', effort: 'medium', permission: 'read-only', budgetUsd: 0.25, timeoutSeconds: 90 },
	briefing: { model: 'claude-sonnet-5', effort: 'medium', permission: 'read-only', budgetUsd: 0.25, timeoutSeconds: 120 },
	'weekly-review': { model: 'claude-opus-5', effort: 'high', permission: 'read-only', budgetUsd: 1, timeoutSeconds: 300 },
	capture: { model: 'claude-haiku-4-5-20251001', effort: 'low', permission: 'propose', budgetUsd: 0.1, timeoutSeconds: 90 },
	'suggest-flashcards': { model: 'claude-sonnet-5', effort: 'medium', permission: 'propose', budgetUsd: 0.25, timeoutSeconds: 120 },
	timesheet: { model: 'claude-sonnet-5', effort: 'high', permission: 'propose', budgetUsd: 0.25, timeoutSeconds: 180 }
};

export const FEATURE_LABELS: Record<FeatureId, string> = {
	ask: 'Ask',
	insights: 'Insights',
	briefing: 'Morning briefing',
	'weekly-review': 'Weekly review',
	capture: 'Capture and file',
	'suggest-flashcards': 'Suggest flashcards',
	timesheet: 'Timesheet draft'
};

/** The caps G7 enforces, whatever an individual feature's row asks for. */
export interface BudgetLimits {
	dailyUsd: number;
	maxConcurrent: number;
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

export type GuardrailId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7' | 'G8' | 'G9' | 'G10';

/** The ten guardrails of SPEC 7.2, by the number the spec gives them. */
export const GUARDRAILS: Record<GuardrailId, string> = {
	G1: 'No direct writes',
	G2: 'Read-only by default',
	G3: 'Sandbox for tool runs',
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

/** The fields of a task-line edit a proposal may ask for. Mirrors `TaskEdit`. */
export interface TaskLineEdit {
	status?: 'todo' | 'done' | 'in-progress' | 'cancelled' | 'blocked';
	time?: { start: string; end: string } | null;
	quadrant?: number | null;
	text?: string;
	due?: string | null;
	id?: string | null;
	blockedBy?: string[] | null;
	addTags?: string[];
	removeTags?: string[];
}

/**
 * One concrete change, as an intention rather than as bytes.
 *
 * The kinds are a closed set on purpose: the guardrails need to reason about
 * what a change *means* ("is this a deletion?", "is this a rename out of
 * Inbox?"), and a bag of character offsets cannot answer that. The bytes are
 * computed from the intention by our own code, never by the model, which is
 * also why there is no `delete` kind — nothing in this phase removes a file.
 */
export type ProposalEdit =
	| { id: string; kind: 'create'; path: string; text: string; reason: string }
	| { id: string; kind: 'append'; path: string; text: string; reason: string }
	| { id: string; kind: 'rewrite-task'; path: string; line: number; expectedRaw: string; edit: TaskLineEdit; reason: string }
	| { id: string; kind: 'move'; path: string; to: string; reason: string }
	| { id: string; kind: 'replace-region'; path: string; marker: string; text: string; reason: string };

export type EditKind = ProposalEdit['kind'];

export const EDIT_KIND_LABELS: Record<EditKind, string> = {
	create: 'New note',
	append: 'Append',
	'rewrite-task': 'Rewrite task line',
	move: 'Move',
	'replace-region': 'Replace marker region'
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
	/** Destination, for a move. */
	to?: string;
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

/** Where a question is allowed to look. */
export type Scope =
	| { kind: 'vault' }
	| { kind: 'workspace'; slug: string }
	| { kind: 'folder'; path: string }
	| { kind: 'note'; path: string };

export function scopeLabel(scope: Scope): string {
	switch (scope.kind) {
		case 'vault':
			return 'Whole vault';
		case 'workspace':
			return `Workspace: ${scope.slug}`;
		case 'folder':
			return `Folder: ${scope.path}`;
		case 'note':
			return `This note: ${scope.path}`;
	}
}

/** One note the answer leaned on, so a claim can be checked against the source. */
export interface Citation {
	path: string;
	title: string;
	/** Heading the passage came from, when the note was trimmed to a section. */
	heading: string | null;
}

/** A read-only answer: prose, the notes behind it, and what produced it. */
export interface Answer {
	question: string;
	scope: Scope;
	text: string;
	citations: Citation[];
	stamp: RunStamp;
	/** Set instead of `text` when the run failed or was refused. */
	problem?: string;
	refusals?: Refusal[];
}

/** Rough token count, four characters to the token. Used for budgeting only. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export type DiffRow = { kind: 'same' | 'add' | 'remove'; text: string; line: number };

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
 * What a briefing run produced, as the card needs it.
 *
 * Here rather than beside the module that builds it because the browser shows
 * this and a component may not import from `$server`. `text` is the region as
 * it now stands in the note; `proposal` is set only when the note had no
 * markers, which is the case a human has to accept.
 */
export interface BriefingRun {
	day: string;
	text: string | null;
	proposal: Proposal | null;
	problem: string | null;
	stamp: RunStamp;
}
