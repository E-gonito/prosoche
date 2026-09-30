/**
 * A suggested commit message for the Sync page: the model reads the diffs of
 * the files about to be committed and answers one line, `docs(<scope>): <what
 * changed>`.
 *
 * A suggestion only. The line goes into the page's message box, where the
 * person edits it or not and then commits; nothing here writes a note or
 * commits anything. The diffs are quoted to the model as data (G8), and its
 * answer is used only if it is one line in the form asked for.
 */

import type { Vault } from '../vault/index';
import { wrapAsData } from './guardrails';
import { runDraft, type DraftOptions, type Source } from './run';
import type { Refusal } from '$lib/shared/ai';

/** How much of one file's diff goes into the prompt. */
const DIFF_CHARS = 4000;
/** How much diff in all; the files past it are named but not shown. */
const TOTAL_CHARS = 24_000;
/** A commit subject longer than this is cut at a word. */
const SUBJECT_CHARS = 72;

const FORM = /^docs\(([a-z0-9][a-z0-9 ._/&-]{0,39})\): *(\S.*)$/;

export type CommitSuggestion = { ok: true; message: string } | { ok: false; problem: string; refusals: Refusal[] };

/**
 * Ask for a commit message for `paths`.
 *
 * Inputs: the vault, whose sync provider gives the pending files and their
 * diffs, and the paths the person ticked. Only paths that really have local
 * changes are read; none of them is a problem, not an error. Output: the
 * message, or why there is none (AI off, over budget, a failed run, or an
 * answer not in the form). Side effects: reads the diffs, runs `runDraft`
 * (kill switch, budget, read-only CLI, audit log). Never writes a note and
 * never commits.
 */
export async function suggestCommitMessage(vault: Vault, paths: string[], options: DraftOptions = {}): Promise<CommitSuggestion> {
	const pending = new Set((await vault.sync.pending()).map((f) => f.path));
	const chosen = [...new Set(paths)].filter((p) => pending.has(p));
	if (chosen.length === 0) return { ok: false, problem: 'None of those files has changes to commit.', refusals: [] };

	const diffs: Source[] = [];
	for (const path of chosen) diffs.push({ path, text: (await vault.sync.diff(path)).slice(0, DIFF_CHARS) });

	const run = await runDraft(vault, {
		feature: 'commit-message',
		prompt: commitPrompt(diffs),
		system:
			'You write git commit subjects for changes to a personal notes vault. ' +
			'Answer with exactly one line, `docs(<scope>): <summary>`, and nothing else.',
		paths: chosen,
		note: `message for ${chosen.length} file${chosen.length === 1 ? '' : 's'}`,
		cli: options.cli
	});
	if (!run.ok) return { ok: false, problem: run.problem, refusals: run.refusals };

	const message = commitLine(run.value);
	return message
		? { ok: true, message }
		: { ok: false, problem: 'The suggestion did not come back as one docs(x): y line. Try again, or write it yourself.', refusals: [] };
}

/**
 * The prompt for `diffs`, each a file's path and its unified diff. The diffs
 * go in as data, and past `TOTAL_CHARS` a file is listed by path only. Pure.
 */
export function commitPrompt(diffs: Source[]): string {
	const shown: Source[] = [];
	const unshown: string[] = [];
	let chars = 0;
	for (const d of diffs) {
		if (shown.length && chars + d.text.length > TOTAL_CHARS) unshown.push(d.path);
		else {
			shown.push(d);
			chars += d.text.length;
		}
	}
	return [
		'Write one git commit subject for the changes below, in the form `docs(<scope>): <summary>`.',
		'- scope: one or two lowercase words for the area changed, such as a folder, project or topic (journal, glossary, eye2gene, study)',
		'- summary: what changed, lowercase, imperative, no full stop, e.g. "add ten networking terms"',
		`- at most ${SUBJECT_CHARS} characters in all`,
		'Name what the notes are about, not that files changed.',
		...(unshown.length ? ['', `Also changed, diff not shown: ${unshown.join(', ')}`] : []),
		'',
		wrapAsData(shown)
	].join('\n');
}

/**
 * The commit subject in a model's answer, or null when it holds no
 * `docs(<scope>): <summary>` line. Takes the first such line, drops quotes
 * and backticks around it, lowercases the scope, and cuts the whole at a word
 * to `SUBJECT_CHARS`. Pure.
 */
export function commitLine(answer: string): string | null {
	for (const raw of answer.split('\n')) {
		const line = raw.trim().replace(/^[`'"]+|[`'".]+$/g, '').trim();
		const match = FORM.exec(line.replace(/^docs\(([^)]*)\)/i, (_, scope: string) => `docs(${scope.toLowerCase().trim()})`));
		if (!match) continue;
		const whole = `docs(${match[1]}): ${match[2].trim()}`;
		if (whole.length <= SUBJECT_CHARS) return whole;
		const cut = whole.slice(0, SUBJECT_CHARS + 1);
		return cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:-]+$/, '');
	}
	return null;
}
