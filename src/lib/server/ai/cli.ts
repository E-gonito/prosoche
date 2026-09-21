/**
 * The bridge to the `claude` command line.
 *
 * Nothing outside this file knows a flag. That matters more here than
 * elsewhere, because the flags are the security boundary: `--add-dir`,
 * `--permission-mode` and the tool lists are what stand between a language
 * model and the user's notes, and a second place that built an argument list
 * would be a second place to get them wrong.
 *
 * The contract with callers is that this never throws for anything the model
 * or the CLI does. A crash, a timeout, a gigabyte of output, a non-zero exit,
 * JSON that is not JSON - each comes back as a typed failure with a reason,
 * because every one of them is a thing that will happen on a Tuesday and none
 * of them should surface as a 500.
 *
 * Two flags are absent by construction and asserted in the tests:
 * `--dangerously-skip-permissions` is never passed, and neither the working
 * directory nor any `--add-dir` may be the real vault.
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { config } from '../config';
import { requireSandboxRoot, toolPolicyFor } from './guardrails';
import type { Refusal, RunSettings } from '$lib/shared/ai';

/**
 * Where the CLI lives and how long to wait for it to start.
 *
 * Read from the environment rather than hardcoded so the tests can point at a
 * shell script that echoes canned JSON. Belongs in `config.ts` with the rest
 * of the settings; it is here only because that file is not this phase's to
 * edit, and moving it is a one-line change.
 */
export const cliConfig = {
	/** Executable. `claude` on the PATH unless the environment says otherwise. */
	executable: process.env.HUB_CLAUDE_BIN ?? 'claude',
	/** Output past this is a runaway, not an answer. */
	maxOutputBytes: Number(process.env.HUB_CLAUDE_MAX_BYTES ?? 4 * 1024 * 1024)
};

export interface RunRequest {
	prompt: string;
	settings: RunSettings;
	/** Appended to the system prompt: the vault's CLAUDE.md and hub conventions. */
	systemPrompt?: string;
	/**
	 * Absolute path of the sandbox copy, for a run with tools. Required in
	 * `propose` and `apply` modes and refused in `read-only`, where there is
	 * nothing for the model to open.
	 */
	sandboxRoot?: string;
	/** JSON schema the CLI is asked to conform to, for structured features. */
	jsonSchema?: unknown;
}

export type RunResult =
	| { ok: true; text: string; json: unknown; costUsd: number; durationMs: number }
	| {
			ok: false;
			reason: 'refused' | 'timeout' | 'too-large' | 'exit' | 'bad-json' | 'spawn-failed';
			message: string;
			refusals: Refusal[];
			durationMs: number;
	  };

/** Everything the runner touches that is not pure, so a test can replace it. */
export interface CliDeps {
	spawn: typeof nodeSpawn;
	vaultPath: string;
	executable: string;
	maxOutputBytes: number;
	now: () => number;
}

function defaults(): CliDeps {
	return {
		spawn: nodeSpawn,
		vaultPath: config.vaultPath,
		executable: cliConfig.executable,
		maxOutputBytes: cliConfig.maxOutputBytes,
		now: () => Date.now()
	};
}

/**
 * Build the argument list for one run.
 *
 * Pure, and exported, because the arguments are the thing worth asserting:
 * the tests read this list and check that the vault is not in it and that no
 * bypass flag is. Inputs: the request. Output: the arguments and the working
 * directory. Side effects: none - it spawns nothing.
 *
 * Never includes `--dangerously-skip-permissions`. Never names a directory
 * other than the sandbox. In read-only mode it passes an empty `--tools`, so
 * the model has no way to touch a filesystem at all.
 */
export function buildArgs(request: RunRequest): { args: string[]; cwd: string } {
	const policy = toolPolicyFor(request.settings.permission);
	const args = [
		'-p',
		request.prompt,
		'--output-format',
		'json',
		'--no-session-persistence',
		'--bare',
		'--model',
		request.settings.model,
		'--effort',
		request.settings.effort,
		'--max-budget-usd',
		String(request.settings.budgetUsd)
	];

	if (policy.needsSandbox) {
		args.push('--allowedTools', policy.allowed.join(','));
		args.push('--permission-mode', 'acceptEdits');
		args.push('--add-dir', request.sandboxRoot ?? '');
	} else {
		// An empty tool list, not an omitted one: omitting it would leave the
		// CLI's own defaults in charge of what a model may open.
		args.push('--tools', '');
		args.push('--permission-mode', 'plan');
	}
	args.push('--disallowedTools', policy.disallowed.join(','));

	if (request.systemPrompt) args.push('--append-system-prompt', request.systemPrompt);
	if (request.jsonSchema !== undefined) args.push('--json-schema', JSON.stringify(request.jsonSchema));

	// A read-only run has no business having a working directory inside
	// anything interesting, so it gets the OS temp root.
	const cwd = policy.needsSandbox ? (request.sandboxRoot ?? '') : (process.env.TMPDIR ?? '/tmp');
	return { args, cwd };
}

/**
 * Run the CLI once and return what it said.
 *
 * Inputs: the request, and optionally replacements for the impure parts so a
 * test can inject a fake executable. Output: the parsed result, or a typed
 * failure. Side effects: spawns a process, kills it at the timeout.
 *
 * Never throws. Never runs with the vault as its working directory or in
 * `--add-dir` - G3 is checked here, on the strings about to be handed to
 * `spawn`, so a caller that computed the sandbox path wrongly gets a refusal
 * instead of a model with write access to the real notes. Output past the byte
 * cap kills the process rather than filling memory.
 */
export async function runClaude(request: RunRequest, overrides: Partial<CliDeps> = {}): Promise<RunResult> {
	const deps = { ...defaults(), ...overrides };
	const started = deps.now();
	const { args, cwd } = buildArgs(request);
	const took = () => deps.now() - started;

	const addDirs = args.flatMap((arg, i) => (arg === '--add-dir' ? [args[i + 1] ?? ''] : []));
	const refusals = requireSandboxRoot({ cwd, addDirs }, deps.vaultPath, request.settings.permission);
	if (args.includes('--dangerously-skip-permissions')) {
		// Unreachable from `buildArgs`; kept so that if it ever becomes
		// reachable, the run stops here rather than succeeding quietly.
		refusals.push({
			guardrail: 'G2',
			title: 'Read-only by default',
			message: 'A run tried to skip the permission prompt.'
		});
	}
	if (refusals.length) {
		return { ok: false, reason: 'refused', message: refusals[0].message, refusals, durationMs: took() };
	}

	const raw = await collect(deps, args, cwd, request.settings.timeoutSeconds * 1000);
	if (!raw.ok) return { ...raw, refusals: [], durationMs: took() };

	return parseOutput(raw.stdout, took());
}

/**
 * Parse the CLI's `--output-format json` envelope.
 *
 * Exported so the shapes it tolerates are pinned by a test rather than
 * discovered in production: the result may be under `result`, `text` or the
 * whole body, and the cost may be `total_cost_usd` or `cost_usd`. Inputs: the
 * process's stdout. Output: a result or a `bad-json` failure. Side effects:
 * none.
 */
export function parseOutput(stdout: string, durationMs: number): RunResult {
	const trimmed = stdout.trim();
	if (trimmed === '') {
		return { ok: false, reason: 'bad-json', message: 'The CLI returned nothing.', refusals: [], durationMs };
	}

	let body: unknown;
	try {
		body = JSON.parse(trimmed);
	} catch {
		return {
			ok: false,
			reason: 'bad-json',
			message: 'The CLI did not return JSON. Its output was kept in the audit log.',
			refusals: [],
			durationMs
		};
	}

	const envelope = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
	if (envelope.is_error === true || typeof envelope.error === 'string') {
		const message = typeof envelope.error === 'string' ? envelope.error : 'The model reported an error.';
		return { ok: false, reason: 'exit', message, refusals: [], durationMs };
	}

	const text =
		typeof envelope.result === 'string'
			? envelope.result
			: typeof envelope.text === 'string'
				? envelope.text
				: typeof body === 'string'
					? body
					: '';
	const costUsd = numberOr(envelope.total_cost_usd, numberOr(envelope.cost_usd, 0));
	const json = envelope.result !== undefined && typeof envelope.result !== 'string' ? envelope.result : parseMaybe(text);

	return { ok: true, text, json, costUsd, durationMs };
}

/** Some features ask for JSON in the prose; a plain answer leaves this null. */
function parseMaybe(text: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
	const candidate = (fenced ? fenced[1] : text).trim();
	if (!candidate.startsWith('{') && !candidate.startsWith('[')) return null;
	try {
		return JSON.parse(candidate);
	} catch {
		return null;
	}
}

function numberOr(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

type Collected =
	| { ok: true; stdout: string }
	| { ok: false; reason: 'timeout' | 'too-large' | 'exit' | 'spawn-failed'; message: string };

/**
 * Run the process, capping both how long it may take and how much it may say.
 * Both caps kill the child, because a CLI that has gone wrong will otherwise
 * sit there holding a slot against the concurrency limit.
 */
function collect(deps: CliDeps, args: string[], cwd: string, timeoutMs: number): Promise<Collected> {
	return new Promise((resolve) => {
		let child: ChildProcess;
		try {
			child = deps.spawn(deps.executable, args, {
				cwd,
				// A deliberately bare environment: the CLI needs its own config
				// and a home directory, and nothing else this process happens to
				// be holding.
				env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' },
				stdio: ['ignore', 'pipe', 'pipe']
			});
		} catch (e) {
			resolve({ ok: false, reason: 'spawn-failed', message: e instanceof Error ? e.message : String(e) });
			return;
		}

		let stdout = '';
		let stderr = '';
		let bytes = 0;
		let settled = false;
		const finish = (value: Collected): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};

		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			finish({ ok: false, reason: 'timeout', message: `The run passed its ${Math.round(timeoutMs / 1000)}s limit.` });
		}, timeoutMs);

		child.stdout?.on('data', (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > deps.maxOutputBytes) {
				child.kill('SIGKILL');
				finish({ ok: false, reason: 'too-large', message: `The run produced more than ${deps.maxOutputBytes} bytes.` });
				return;
			}
			stdout += chunk.toString('utf8');
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr = (stderr + chunk.toString('utf8')).slice(0, 4000);
		});

		child.on('error', (e: Error) => finish({ ok: false, reason: 'spawn-failed', message: e.message }));
		child.on('close', (code: number | null) => {
			if (code === 0) finish({ ok: true, stdout });
			else finish({ ok: false, reason: 'exit', message: stderr.trim() || `The CLI exited with code ${code}.` });
		});
	});
}
