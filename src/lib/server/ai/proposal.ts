/**
 * Proposals: what a model is allowed to suggest, and the one place a
 * suggestion becomes bytes on disk.
 *
 * ## Why edits are intentions rather than patches
 *
 * The obvious interface, and the one rejected, is a list of character spans:
 * `{path, start, end, text}`. It matches how `parse/task.ts` rewrites a line
 * and it is maximally precise. It was rejected for three reasons. Offsets are
 * the thing models get wrong most reliably. Offsets go stale the instant the
 * file changes, and there is no way to tell a stale offset from a deliberate
 * one. And, worst, a span loses the intention: the guardrails need to answer
 * "is this a deletion?", "is this a rename out of Inbox?", "is this a new
 * note or a rewrite of an old one?", and a span cannot be asked.
 *
 * So an edit is one of six named intentions, and the bytes it produces are
 * computed here, by our code, from the vault as it is right now. The model
 * never supplies bytes for anything except the text it is adding. The one
 * exception is `revise`, a whole new version of a note, which exists for a
 * document that is meant to be rewritten (a meeting primer); it is pinned to
 * the hash the draft read and still judged on lines lost. The guardrails then
 * run twice over: once on the intention (kind, path) and once on the resolved
 * before-and-after (lines lost, files touched).
 *
 * ## The write rule
 *
 * `apply` is the only function in the whole AI layer that writes to the
 * vault, it writes only what `validate` approved and a human accepted, and it
 * snapshots first. Everything else in `ai/` returns data.
 */

import { config } from '../config';
import { dailyNotePath, shiftDay, type DayKey } from '../daily';
import { rewriteTaskLine } from '../parse/task';
import { isGlossaryPath } from '../glossary';
import type { Vault } from '../vault/index';
import {
	BRIEFING_MARKER,
	checkBlastRadius,
	checkKillSwitch,
	checkPath,
	requireHumanAccept,
	requireUndoSnapshot,
	type BlastLimits,
	type PathPolicy
} from './guardrails';
import { appliedResult, recordApplied, readSnapshot, resolvesInsideVault, snapshot } from './sandbox';
import {
	refuse,
	type ApplyResult,
	type BlastCaps,
	type EditPreview,
	type FeatureId,
	type Proposal,
	type ProposalEdit,
	type Refusal,
	type Validation
} from '$lib/shared/ai';

/** Everything the guardrails need to judge one proposal. */
export interface Policy {
	/** The global kill switch, from `_hub/ai.md`. */
	enabled: boolean;
	path: PathPolicy;
	blast: BlastLimits;
}

/** What a feature's policy depends on beyond the feature itself. */
export interface PolicyContext {
	today: DayKey;
	/** Extra paths this particular run may write: the destination capture
	 *  proposed, the primer, meeting note or glossary a draft names. */
	destinations?: string[];
}

/**
 * The per-feature allowlist of SPEC 7.2.4, in one table.
 *
 * Inputs: the feature, the caps from `_hub/ai.md`, and what this run is
 * about. Output: the policy the guardrails judge it by. Side effects: none.
 *
 * One table rather than a rule per feature module, because "which files may
 * this feature write" is the question an auditor asks, and answering it
 * should mean reading one screen. The default arm is the important one: a
 * feature this version has never heard of writes nothing.
 */
export function policyFor(
	feature: FeatureId,
	settings: { enabled: boolean; blast: BlastCaps },
	ctx: PolicyContext
): Policy {
	const todayNote = dailyNotePath(ctx.today);
	const extra = ctx.destinations ?? [];

	const base: BlastLimits = {
		...settings.blast,
		writableDays: [ctx.today, shiftDay(ctx.today, -1)],
		dailyFolder: config.dailyNote.folder
	};
	const wrap = (allow: string[], blast: Partial<BlastLimits> = {}): Policy => ({
		enabled: settings.enabled,
		path: { feature, allow },
		blast: { ...base, ...blast }
	});

	switch (feature) {
		// The briefing is G1's exception, so its policy is the tightest here:
		// one file, one day, no renames. The overlap with the writable-days
		// list is deliberate - a date bug has to get past both.
		case 'briefing':
			return wrap([todayNote], { maxFiles: 1, writableDays: [ctx.today] });

		// Capture files one thing into the inbox and, at most, one destination
		// it names when it proposes.
		case 'capture':
			return wrap(['Inbox/', ...extra], { maxFiles: 2 });

		// The meeting and glossary features each write one note of one kind,
		// and the destination names it exactly. The destination arrives back
		// from the browser, so it is also held to its kind here: a forged one
		// can at worst name another workspace's primer or meeting note, or
		// another glossary in `Glossaries/`.
		case 'primer-draft':
			return wrap(extra.filter((p) => p.endsWith('/Primer.md')).slice(0, 1), { maxFiles: 1 });
		case 'glossary-lookup':
			return wrap(extra.filter(isGlossaryPath).slice(0, 1), { maxFiles: 1 });
		case 'meeting-prep':
			return wrap(extra.filter((p) => /\/Meetings\/[^/]+\.md$/.test(p)).slice(0, 1), { maxFiles: 1 });

		// Suggest flashcards drafts cards rather than a proposal, and the cards
		// a person keeps are written by `study/card-files.ts`, so a proposal
		// claiming to be one may write nowhere; nor may any feature not named.
		default:
			return wrap([]);
	}
}

/** A resolved edit: the intention, plus the bytes it would produce. */
interface Resolved {
	edit: ProposalEdit;
	before: string;
	after: string;
	/** Hash of the file as it was read, so a clashing write is a conflict. */
	expectedHash: string;
	/** True when the file does not exist yet. */
	fresh: boolean;
	refusals: Refusal[];
}

/**
 * Turn each intention into before-and-after bytes, reading the vault as it is
 * now.
 *
 * Inputs: the vault and the edits. Output: one `Resolved` per edit, carrying
 * any refusal that only reading the file could reveal - a `create` aimed at a
 * note that already exists, a `rewrite-task` whose line has moved, a
 * `replace-region` whose markers are gone.
 *
 * Side effects: reads notes. Never writes, and never invents content: `after`
 * is always the current file with the model's text inserted by our own string
 * handling, so every byte the user did not change survives.
 *
 * G4 runs first, before the file is opened. A path the policy refuses is
 * never handed to the vault module at all, which matters because the vault
 * throws on a path that escapes it: a guardrail should produce a refusal a
 * user can read, not a stack trace.
 */
async function resolve(vault: Vault, edits: ProposalEdit[], policy: PathPolicy): Promise<Resolved[]> {
	const out: Resolved[] = [];
	for (const edit of edits) {
		const pathRefusals = checkPath(edit.path, policy);
		if (pathRefusals.length) {
			out.push({ edit, before: '', after: '', expectedHash: '', fresh: true, refusals: pathRefusals });
			continue;
		}

		const note = await vault.read(edit.path);
		const base = {
			edit,
			before: note.content,
			expectedHash: note.hash,
			fresh: !note.exists,
			refusals: [] as Refusal[]
		};

		switch (edit.kind) {
			case 'create': {
				if (note.exists) {
					out.push({
						...base,
						after: note.content,
						refusals: [refuse('G5', 'That note already exists; creating it would replace what is there.', edit.path)]
					});
					break;
				}
				out.push({ ...base, after: ensureTrailingNewline(edit.text) });
				break;
			}

			case 'append': {
				const body = note.content === '' ? '' : ensureTrailingNewline(note.content);
				out.push({ ...base, after: `${body}${ensureTrailingNewline(edit.text)}` });
				break;
			}

			case 'rewrite-task': {
				const lines = note.content.split('\n');
				const current = lines[edit.line];
				if (!note.exists) {
					out.push({
						...base,
						after: note.content,
						refusals: [refuse('G6', 'That note does not exist, so it has no task line to rewrite.', edit.path)]
					});
					break;
				}
				if (current !== edit.expectedRaw) {
					out.push({
						...base,
						after: note.content,
						refusals: [
							refuse('G6', `Line ${edit.line + 1} is not what the proposal expected, so it was left alone.`, edit.path)
						]
					});
					break;
				}
				lines[edit.line] = rewriteTaskLine(current, edit.edit);
				out.push({ ...base, after: lines.join('\n') });
				break;
			}

			case 'replace-region': {
				const replaced = replaceRegion(note.content, edit.marker, edit.text);
				if (replaced === null) {
					out.push({
						...base,
						after: note.content,
						refusals: [
							refuse('G1', `The ${edit.marker} markers are not in that note, so there is no region to write.`, edit.path)
						]
					});
					break;
				}
				out.push({ ...base, after: replaced });
				break;
			}

			case 'revise': {
				if (!note.exists) {
					out.push({
						...base,
						after: note.content,
						refusals: [refuse('G6', 'That note does not exist, so there is nothing to revise.', edit.path)]
					});
					break;
				}
				if (note.hash !== edit.expectedHash) {
					out.push({
						...base,
						after: note.content,
						refusals: [refuse('G6', 'That note changed after this was drafted, so it was left alone. Draft it again.', edit.path)]
					});
					break;
				}
				out.push({ ...base, after: edit.text });
				break;
			}

			default:
				// A kind this build does not know, such as one in a hand-written
				// request body: refuse it, never guess.
				out.push({
					...base,
					after: note.content,
					refusals: [refuse('G5', `Unknown edit kind "${(edit as { kind: string }).kind}".`, base.edit.path)]
				});
				break;
		}
	}
	return out;
}

/**
 * Run every guardrail over a proposal and say whether it may be applied.
 *
 * Inputs: the vault (read only), the proposal, and the policy for its
 * feature. Output: `ok: true` with the previews when nothing objected, or
 * `ok: false` with the refusals - each naming the guardrail that fired - and
 * the previews anyway, because a user wants to see what was stopped.
 *
 * Side effects: reads notes. Never writes, never spawns anything, and never
 * returns `ok: true` for a proposal with a refusal anywhere in it, including
 * refusals attached to a single edit.
 */
export async function validate(vault: Vault, proposal: Proposal, policy: Policy): Promise<Validation> {
	const refusals: Refusal[] = [...checkKillSwitch(policy.enabled)];
	const resolved = await resolve(vault, proposal.edits, policy.path);
	// Blast radius is judged only on the edits that got as far as bytes; a
	// path already refused should not also be reported as emptying a file.
	refusals.push(...checkBlastRadius(resolved.filter((r) => r.refusals.length === 0), policy.blast));

	const previews = resolved.map(toPreview);
	const all = [...refusals, ...previews.flatMap((p) => p.refusals)];
	if (all.length) return { ok: false, refusals: dedupe(all), previews };
	return { ok: true, proposal, previews };
}

function toPreview(item: Resolved): EditPreview {
	const base = {
		id: item.edit.id,
		kind: item.edit.kind,
		path: item.edit.path,
		reason: item.edit.reason,
		before: item.before,
		after: item.after,
		refusals: item.refusals
	};
	return base;
}

/** Where `apply` puts its snapshots, and which ids the human ticked. */
export interface ApplyOptions {
	/** Edit ids the user accepted. Defaults to the proposal's own list. */
	accepted?: string[];
	/** The vault root, for the symlink check. Defaults to `config.vaultPath`. */
	vaultPath?: string;
	/** Where snapshots go. Defaults to `config.undoPath`. */
	undoPath?: string;
}

/**
 * Write the edits a human accepted, and nothing else.
 *
 * Inputs: the vault, the proposal, the policy, and the edit ids the user
 * ticked. Output: what was written, what was refused, and the id of the undo
 * snapshot. Side effects: writes notes through `Vault.write`, writes an undo
 * snapshot and a receipt under `config.undoPath`.
 *
 * Safe to call twice. The second call finds the receipt and returns the first
 * result unchanged, so a double-clicked Accept or a replayed POST cannot
 * append the same paragraph twice; and every write carries the hash the file
 * had a moment earlier, so a note edited in Obsidian in between comes back as
 * a conflict rather than being overwritten.
 *
 * Never writes an edit that failed a guardrail, never writes before the
 * snapshot exists, and never writes anything at all when the kill switch is
 * off or when nothing was accepted.
 */
export async function apply(
	vault: Vault,
	proposal: Proposal,
	policy: Policy,
	options: ApplyOptions = {}
): Promise<ApplyResult> {
	const acceptedIds = options.accepted ?? proposal.accepted;
	const vaultPath = options.vaultPath ?? config.vaultPath;
	const undoPath = options.undoPath ?? config.undoPath;

	const receipt = await appliedResult<ApplyResult>(proposal.id, undoPath);
	if (receipt) return receipt;

	const stop = checkKillSwitch(policy.enabled);
	if (stop.length) return { written: [], refusals: stop, undoId: null };

	const accept = requireHumanAccept(proposal, acceptedIds);
	if (accept.edits.length === 0) return { written: [], refusals: accept.refusals, undoId: null };

	// Validate the accepted subset, not the whole proposal: a user who ticks
	// the three good edits and leaves the bad one should get the three.
	const subset: Proposal = { ...proposal, edits: accept.edits, accepted: accept.edits.map((e) => e.id) };
	const checked = await validate(vault, subset, policy);
	if (!checked.ok) {
		return { written: [], refusals: dedupe([...accept.refusals, ...checked.refusals]), undoId: null };
	}

	const refusals = [...accept.refusals];
	const writable: EditPreview[] = [];
	for (const preview of checked.previews) {
		if (await resolvesInsideVault(preview.path, vaultPath)) writable.push(preview);
		else refusals.push(refuse('G4', 'That path resolves outside the vault through a link.', preview.path));
	}
	if (writable.length === 0) return { written: [], refusals, undoId: null };

	// G9: snapshot before the first write, and refuse anything not covered.
	const taken = await snapshot(
		proposal.id,
		writable.map((p) => ({ path: p.path, content: p.before === '' && p.kind === 'create' ? null : p.before })),
		undoPath
	);
	const missing = requireUndoSnapshot(
		writable.map((p) => p.path),
		taken.paths
	);
	if (missing.length) return { written: [], refusals: [...refusals, ...missing], undoId: null };

	const written: string[] = [];
	for (const preview of writable) {
		if (preview.after === preview.before) continue;
		const current = await vault.read(preview.path);
		const result = await vault.write(preview.path, preview.after, current.hash);
		if (result.ok) written.push(preview.path);
		else refusals.push(refuse('G9', 'That note changed on another device, so it was left alone.', preview.path));
	}

	const applied: ApplyResult = { written, refusals: dedupe(refusals), undoId: taken.id };
	await recordApplied(proposal.id, applied, undoPath);
	return applied;
}

/**
 * Put back the bytes a snapshot holds.
 *
 * Inputs: the vault and a snapshot id. Output: the paths restored. Side
 * effects: writes those notes through `Vault.write`, so an undo is watched,
 * reindexed and committed like any other edit.
 *
 * Never deletes. A note the proposal created has no previous bytes to put
 * back, so it is reported as skipped and left where it is: deleting a file is
 * not something this phase does, and a stray note is easier to live with than
 * a deletion nobody asked for. A snapshot that has been pruned restores
 * nothing rather than erroring.
 */
export async function undo(
	vault: Vault,
	undoId: string,
	undoPath: string = config.undoPath
): Promise<{ restored: string[]; skipped: string[] }> {
	const files = await readSnapshot(undoId, undoPath);
	const restored: string[] = [];
	const skipped: string[] = [];
	for (const file of files) {
		if (file.content === null) {
			skipped.push(file.path);
			continue;
		}
		const result = await vault.write(file.path, file.content);
		if (result.ok) restored.push(file.path);
		else skipped.push(file.path);
	}
	return { restored, skipped };
}

/* -------------------------------------------------------- marker regions -- */

const markerRegion = (marker: string): RegExp =>
	new RegExp(`([ \\t]*<!--\\s*${escapeRegex(marker)}\\s+start\\s*-->)([\\s\\S]*?)([ \\t]*<!--\\s*${escapeRegex(marker)}\\s+end\\s*-->)`);

/**
 * Replace the text between `<!-- marker start -->` and `<!-- marker end -->`.
 *
 * The hub's one automatic write lands here, so this function is what keeps
 * that promise: it rebuilds the note as head plus marker plus new body plus
 * marker plus tail, all three of the outer pieces taken verbatim from the
 * original string. Every byte outside the region is the same object it was.
 *
 * Inputs: the note, the marker name, the replacement body. Output: the new
 * note, or null when the markers are absent, which callers turn into a
 * proposal to add them rather than guessing where they should go.
 *
 * Side effects: none - a pure string function, which is why it can be tested
 * against a note full of the user's own writing.
 */
export function replaceRegion(content: string, marker: string, body: string): string | null {
	const match = markerRegion(marker).exec(content);
	if (!match) return null;
	const [whole, open, , close] = match;
	const inner = body === '' ? '\n' : `\n${body.replace(/^\n+|\n+$/g, '')}\n`;
	const replacement = `${open}${inner}${close}`;
	return content.slice(0, match.index) + replacement + content.slice(match.index + whole.length);
}

/** The text currently inside a marker region, or null when it is absent. */
export function readRegion(content: string, marker: string): string | null {
	const match = markerRegion(marker).exec(content);
	return match ? match[2].replace(/^\n+|\n+$/g, '') : null;
}

/** The markers themselves, for a proposal that has to add them first. */
export function markerBlock(marker: string = BRIEFING_MARKER): string {
	return `<!-- ${marker} start -->\n<!-- ${marker} end -->`;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------- plumbing -- */

let counter = 0;

/**
 * An id for a proposal or an edit. Time plus a counter rather than a random
 * string, so the applied receipts under `config.undoPath` sort by age and a
 * developer reading that directory can tell what happened when.
 */
export function newId(prefix: string, now = new Date()): string {
	counter = (counter + 1) % 10_000;
	return `${prefix}-${now.toISOString().slice(0, 19).replace(/[:-]/g, '')}-${String(counter).padStart(4, '0')}`;
}

function ensureTrailingNewline(text: string): string {
	return text.endsWith('\n') ? text : `${text}\n`;
}

function dedupe(refusals: Refusal[]): Refusal[] {
	const seen = new Set<string>();
	return refusals.filter((r) => {
		const key = `${r.guardrail}|${r.path ?? ''}|${r.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
