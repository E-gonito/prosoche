/**
 * The bridge to the `claude` command line.
 *
 * Nothing outside this file knows a flag. That matters more here than
 * elsewhere, because the flags are the security boundary: the empty tool
 * list, `--permission-mode plan` and the refused tools are what stand between
 * a language model and the user's notes, and a second place that built an
 * argument list would be a second place to get them wrong.
 *
 * The contract with callers is that this never throws for anything the model
 * or the CLI does. A crash, a timeout, a gigabyte of output, a non-zero exit,
 * JSON that is not JSON - each comes back as a typed failure with a reason,
 * because every one of them is a thing that will happen on a Tuesday and none
 * of them should surface as a 500.
 *
 * Every run is read-only (G2). Two flags are absent by construction and
 * asserted in the tests: `--dangerously-skip-permissions` and `--add-dir`
 * are never passed, and the working directory is never inside the vault.
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { config } from '../config';
import { NEVER, requireOutsideVault, toJsonSchema, type Schema } from './guardrails';
import { refuse, type Refusal, type RunSettings } from '$lib/shared/ai';

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
	 * The shape the CLI is asked to conform to, for structured features. Given
	 * as the guardrails' own `Schema`, the one `validateModelOutput` checks
	 * against, and translated to JSON Schema on the way out.
	 */
	jsonSchema?: Schema;
}

type RunResult =
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
 * Never includes `--dangerously-skip-permissions` or `--add-dir`. Always
 * passes an empty `--tools`, so the model has no way to touch a filesystem
 * at all, and runs in the OS temp root rather than anywhere interesting.
 */
export function buildArgs(request: RunRequest): { args: string[]; cwd: string } {
	const args = [
		'-p',
		request.prompt,
		'--output-format',
		'json',
		'--no-session-persistence',
		// Isolation without `--bare`, which reads only ANTHROPIC_API_KEY and so
		// refuses the subscription login this box runs under ("Not logged in").
		// These keep what `--bare` was here for: none of the user's settings
		// or hooks (cwd is never a project), no MCP servers, no skills.
		'--setting-sources',
		'project',
		'--strict-mcp-config',
		'--disable-slash-commands',
		'--model',
		request.settings.model,
		'--effort',
		request.settings.effort,
		'--max-budget-usd',
		String(request.settings.budgetUsd),
		// An empty tool list, not an omitted one: omitting it would leave the
		// CLI's own defaults in charge of what a model may open.
		'--tools',
		'',
		'--permission-mode',
		'plan',
		'--disallowedTools',
		NEVER.join(',')
	];
	if (request.systemPrompt) args.push('--append-system-prompt', request.systemPrompt);
	if (request.jsonSchema !== undefined) args.push('--json-schema', JSON.stringify(toJsonSchema(request.jsonSchema)));
	return { args, cwd: process.env.TMPDIR ?? '/tmp' };
}

/**
 * Run the CLI once and return what it said.
 *
 * Inputs: the request, and optionally replacements for the impure parts so a
 * test can inject a fake executable. Output: the parsed result, or a typed
 * failure. Side effects: spawns a process, kills it at the timeout.
 *
 * Never throws. Never runs with the vault as its working directory, with a
 * directory added or with permissions skipped - G2 is checked here, on the
 * strings about to be handed to `spawn`, so a mistake in `buildArgs` gets a
 * refusal instead of a model that can reach the real notes. Output past the
 * byte cap kills the process rather than filling memory.
 */
export async function runClaude(request: RunRequest, overrides: Partial<CliDeps> = {}): Promise<RunResult> {
	const deps = { ...defaults(), ...overrides };
	const started = deps.now();
	const { args, cwd } = buildArgs(request);
	const took = () => deps.now() - started;

	const refusals = requireOutsideVault(cwd, deps.vaultPath);
	// Unreachable from `buildArgs`; kept so that if either ever becomes
	// reachable, the run stops here rather than succeeding quietly.
	if (args.includes('--dangerously-skip-permissions')) refusals.push(refuse('G2', 'A run tried to skip the permission prompt.'));
	if (args.includes('--add-dir')) refusals.push(refuse('G2', 'A run has no tools and must name no directory.'));
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
 * Exported so the shape it reads is pinned by a test: the prose answer is
 * `result`, the cost `total_cost_usd`, and under `--json-schema` the parsed
 * answer is `structured_output`. `json` is null for a run without a schema.
 * Inputs: the process's stdout. Output: a result or a failure. Side effects:
 * none.
 */
export function parseOutput(stdout: string, durationMs: number): RunResult {
	let body: unknown;
	try {
		body = JSON.parse(stdout.trim());
	} catch {
		const message = stdout.trim() === '' ? 'The CLI returned nothing.' : 'The CLI did not return JSON.';
		return { ok: false, reason: 'bad-json', message, refusals: [], durationMs };
	}

	const envelope = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
	const text = typeof envelope.result === 'string' ? envelope.result : '';
	if (envelope.is_error === true) {
		return { ok: false, reason: 'exit', message: text || 'The model reported an error.', refusals: [], durationMs };
	}
	const json = typeof envelope.structured_output === 'object' ? envelope.structured_output : null;
	return { ok: true, text, json, costUsd: numberOr(envelope.total_cost_usd, 0), durationMs };
}

/**
 * The error a failed run reported in its JSON envelope on stdout, e.g. "Not
 * logged in · Please run /login", or null. The CLI exits non-zero with its
 * reason there rather than on stderr, and "exited with code 1" says nothing.
 */
function envelopeError(stdout: string): string | null {
	const parsed = parseOutput(stdout, 0);
	return !parsed.ok && parsed.reason === 'exit' ? parsed.message : null;
}

function numberOr(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * What to tell the user when the CLI could not be started. A missing
 * executable is the usual case, on a server the CLI was never installed on,
 * and says how to fix it rather than showing the raw `spawn claude ENOENT`.
 */
function spawnFailure(executable: string, e: unknown): string {
	if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
		return `The Claude CLI is not installed on this server: there is no "${executable}" to run. Install Claude Code here, or set HUB_CLAUDE_BIN to its path.`;
	}
	return e instanceof Error ? e.message : String(e);
}

type Collected =
	| { ok: true; stdout: string }
	| { ok: false; reason: 'timeout' | 'too-large' | 'exit' | 'spawn-failed'; message: string };

/**
 * Run the process, capping both how long it may take and how much it may say.
 * Both caps kill the child, because a CLI that has gone wrong will otherwise
 * sit there holding a process and its memory.
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
			resolve({ ok: false, reason: 'spawn-failed', message: spawnFailure(deps.executable, e) });
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

		child.on('error', (e: Error) => finish({ ok: false, reason: 'spawn-failed', message: spawnFailure(deps.executable, e) }));
		child.on('close', (code: number | null) => {
			if (code === 0) finish({ ok: true, stdout });
			else finish({ ok: false, reason: 'exit', message: stderr.trim() || envelopeError(stdout) || `The CLI exited with code ${code}.` });
		});
	});
}
