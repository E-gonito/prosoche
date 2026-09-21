/**
 * Asking the vault a question.
 *
 * One function behind both surfaces: the `/ask` page and the workspace
 * `insights` widget, which is the same thing with its scope already chosen.
 * Having one path means the guardrails, the audit line and the citation rules
 * are the same in both, rather than the widget being a slightly older copy.
 *
 * Both are read-only and stay that way. The permission mode is forced to
 * `read-only` here regardless of what the settings file says, because a chat
 * answer is prose and there is no proposal for it to produce: a mode with
 * tools would be capability with nothing to spend it on, which is the
 * definition of an unnecessary risk. Anything that wants to write goes
 * through `proposal.ts` and a human.
 */

import { today } from '../daily';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';
import type { Workspace } from '../workspaces';
import { config } from '../config';
import { logRun, spentOn } from './audit';
import { runClaude, type CliDeps } from './cli';
import { checkBudget, checkKillSwitch, wrapAsData } from './guardrails';
import { retrieve } from './retrieval';
import { loadSettings } from './settings';
import { scopeLabel, type Answer, type FeatureId, type Refusal, type RunSettings, type Scope } from '$lib/shared/ai';

export interface AskDeps {
	vault: Vault;
	index: NoteIndex;
	workspaces: Workspace[];
}

export interface AskRequest {
	question: string;
	scope: Scope;
	/** `ask` or `insights`; they differ only in their settings row. */
	feature: Extract<FeatureId, 'ask' | 'insights'>;
	/** The per-run choices from the settings row, when the user changed them. */
	override?: Partial<RunSettings>;
	/** The vault's own CLAUDE.md, so answers sound like the user's notes. */
	conventions?: string;
}

/**
 * Runs in flight, for G7's concurrency cap.
 *
 * Process-wide state, which this codebase otherwise keeps in `hub.ts` alone.
 * It is here because it is the AI layer's own accounting and means nothing
 * outside it; the trade is one module-level variable against `hub()` growing
 * a field that only this file reads.
 */
let running = 0;

/**
 * Answer a question from the notes in scope.
 *
 * Inputs: the vault, index and workspaces; the question, the scope and any
 * per-run settings. Output: an `Answer` with its citations and the stamp of
 * what produced it, or the same shape carrying a `problem` and the refusals.
 * Side effects: spawns the CLI, appends to the audit log and to the chat
 * history file.
 *
 * Never writes a note. Never throws: a model that returns nonsense, a CLI
 * that is not installed and a budget that is spent all come back as an answer
 * with a problem, because this is called from a page load and a chat box.
 */
export async function ask(deps: AskDeps, request: AskRequest, overrides: Partial<CliDeps> = {}): Promise<Answer> {
	const day = today();
	const settings = await loadSettings(deps.vault);
	const base = settings.features[request.feature];
	const chosen: RunSettings = { ...base, ...request.override, permission: 'read-only' };

	const spend = await spentOn(deps.vault, day);
	const budget = checkBudget(chosen, { todayUsd: spend.usd, running }, settings.budget);
	const refusals: Refusal[] = [...checkKillSwitch(settings.enabled), ...budget.refusals];
	const stamp = { ...budget.settings, feature: request.feature, startedAt: new Date().toISOString(), durationMs: 0, costUsd: 0 };

	if (request.question.trim() === '') {
		return { question: request.question, scope: request.scope, text: '', citations: [], stamp, problem: 'Ask something first.' };
	}
	if (refusals.length) {
		await logRun(deps.vault, {
			at: stamp.startedAt,
			feature: request.feature,
			model: stamp.model,
			effort: stamp.effort,
			permission: stamp.permission,
			paths: [],
			decision: 'refused',
			guardrails: [...new Set(refusals.map((r) => r.guardrail))],
			costUsd: 0,
			durationMs: 0,
			note: refusals.map((r) => r.message).join(' ')
		});
		return {
			question: request.question,
			scope: request.scope,
			text: '',
			citations: [],
			stamp,
			problem: refusals[0].message,
			refusals
		};
	}

	const found = await retrieve(deps, { question: request.question, scope: request.scope });
	running++;
	let result;
	try {
		result = await runClaude(
			{
				prompt: prompt(request, found.passages),
				settings: budget.settings,
				systemPrompt: systemPrompt(request, found.passages.length, request.conventions)
			},
			overrides
		);
	} finally {
		running--;
	}

	const paths = [...new Set(found.passages.map((p) => p.path))];
	const finished = { ...stamp, durationMs: result.durationMs, costUsd: result.ok ? result.costUsd : 0 };

	await logRun(deps.vault, {
		at: stamp.startedAt,
		feature: request.feature,
		model: finished.model,
		effort: finished.effort,
		permission: finished.permission,
		paths,
		decision: result.ok ? 'answered' : result.reason === 'refused' ? 'refused' : 'failed',
		guardrails: result.ok ? [] : [...new Set(result.refusals.map((r) => r.guardrail))],
		costUsd: finished.costUsd,
		durationMs: finished.durationMs,
		note: result.ok ? request.question : result.message
	});

	if (!result.ok) {
		return {
			question: request.question,
			scope: request.scope,
			text: '',
			citations: found.citations,
			stamp: finished,
			problem: result.message,
			refusals: result.refusals
		};
	}

	const answer: Answer = {
		question: request.question,
		scope: request.scope,
		text: result.text.trim(),
		citations: found.citations,
		stamp: finished
	};
	await remember(deps.vault, answer);
	return answer;
}

/**
 * The prompt. Note text goes through `wrapAsData` (G8) so that a line in
 * someone's notes reading "ignore the above" is quoted material rather than
 * an instruction.
 */
function prompt(request: AskRequest, passages: Array<{ path: string; text: string }>): string {
	if (passages.length === 0) {
		return [
			`Question: ${request.question}`,
			'',
			`No notes in scope (${scopeLabel(request.scope)}) matched this question.`,
			'Say so in one sentence. Do not answer from general knowledge.'
		].join('\n');
	}
	return [`Question: ${request.question}`, '', wrapAsData(passages)].join('\n');
}

function systemPrompt(request: AskRequest, count: number, conventions?: string): string {
	return [
		'You are answering questions about one person\'s markdown notes.',
		`The scope of this question is: ${scopeLabel(request.scope)}. ${count} passages were retrieved.`,
		'Answer only from the passages. If they do not say, say that they do not say.',
		'Cite the notes you used by their path, in square brackets, as you use them.',
		'Be brief. This person wrote these notes and does not need them summarised back at length.',
		conventions ? `\nTheir own conventions:\n${conventions.slice(0, 4000)}` : ''
	]
		.filter(Boolean)
		.join('\n');
}

/* -------------------------------------------------------- chat history --- */

/** `_hub/chat/2026-09.md`. In G4's denied set, so no AI path can edit it. */
export function historyPath(at: string): string {
	return `${config.hubFolder}/chat/${at.slice(0, 7)}.md`;
}

/**
 * Append a question and its answer to the month's chat file.
 *
 * SPEC 6 keeps conversation history in SQLite and out of the vault. This
 * codebase puts all SQL in `src/lib/server/index/`, whose tables are a
 * rebuildable cache dropped on every schema change, so chat history there
 * would be deleted by the next index rebuild. Markdown under `_hub/chat/`
 * survives that, reads in Obsidian, and syncs with everything else. Noted as
 * a deliberate divergence in the phase report.
 *
 * Inputs: the vault and an answer. Output: nothing. Side effects: writes one
 * note. Never fails a run - an answer the user can read matters more than the
 * transcript of it.
 */
async function remember(vault: Vault, answer: Answer): Promise<void> {
	try {
		const path = historyPath(answer.stamp.startedAt);
		const note = await vault.read(path);
		const head = note.exists ? note.content.replace(/\s+$/, '') : `# Ask history, ${answer.stamp.startedAt.slice(0, 7)}`;
		const entry = [
			'',
			`## ${answer.stamp.startedAt.slice(0, 16).replace('T', ' ')} · ${scopeLabel(answer.scope)}`,
			`**${answer.question.replace(/\n+/g, ' ')}**`,
			'',
			answer.text,
			'',
			answer.citations.length ? `Sources: ${answer.citations.map((c) => `[[${c.path.replace(/\.md$/, '')}]]`).join(', ')}` : '',
			`*${answer.stamp.model} · ${answer.stamp.effort} · ${answer.stamp.permission}*`
		]
			.filter((line) => line !== '')
			.join('\n');
		await vault.write(path, `${head}\n\n${entry}\n`, note.exists ? note.hash : undefined);
	} catch {
		// Losing a transcript line is not worth losing the answer over.
	}
}
