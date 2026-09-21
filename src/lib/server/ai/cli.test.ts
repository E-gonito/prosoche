import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildArgs, parseOutput, runClaude, type RunRequest } from './cli';
import type { RunSettings } from '$lib/shared/ai';

const READ_ONLY: RunSettings = {
	model: 'claude-sonnet-5',
	effort: 'medium',
	permission: 'read-only',
	budgetUsd: 0.25,
	timeoutSeconds: 5
};
const WITH_TOOLS: RunSettings = { ...READ_ONLY, permission: 'propose' };

const VAULT = '/home/dev/vault';

let scratch: string;
beforeEach(async () => {
	scratch = await mkdtemp(join(tmpdir(), 'hub-cli-'));
});
afterEach(async () => {
	await rm(scratch, { recursive: true, force: true });
});

/** A stand-in for the real CLI: a shell script that prints what it is told. */
async function fakeClaude(body: string, exitCode = 0): Promise<string> {
	const path = join(scratch, 'fake-claude');
	await writeFile(path, `#!/bin/sh\ncat <<'JSON'\n${body}\nJSON\nexit ${exitCode}\n`, 'utf8');
	await chmod(path, 0o755);
	return path;
}

const value = (args: string[], flag: string): string | undefined => {
	const at = args.indexOf(flag);
	return at === -1 ? undefined : args[at + 1];
};

describe('buildArgs', () => {
	const request = (over: Partial<RunRequest> = {}): RunRequest => ({
		prompt: 'what is on today?',
		settings: READ_ONLY,
		...over
	});

	it('never passes --dangerously-skip-permissions, in any mode', () => {
		for (const settings of [READ_ONLY, WITH_TOOLS, { ...READ_ONLY, permission: 'apply' as const }]) {
			const { args } = buildArgs(request({ settings, sandboxRoot: '/tmp/sbx' }));
			expect(args).not.toContain('--dangerously-skip-permissions');
			expect(args.join(' ')).not.toMatch(/bypassPermissions|skip-permissions/);
		}
	});

	it('never names the vault as a directory or a working directory', () => {
		const { args, cwd } = buildArgs(request({ settings: WITH_TOOLS, sandboxRoot: '/tmp/sbx' }));
		expect(args).not.toContain(VAULT);
		expect(value(args, '--add-dir')).toBe('/tmp/sbx');
		expect(cwd).toBe('/tmp/sbx');
	});

	it('passes an empty tool list for a read-only run, rather than omitting it', () => {
		const { args } = buildArgs(request());
		expect(value(args, '--tools')).toBe('');
		expect(args).not.toContain('--add-dir');
		expect(value(args, '--permission-mode')).toBe('plan');
	});

	it('passes an explicit allowlist for a tool run', () => {
		const { args } = buildArgs(request({ settings: WITH_TOOLS, sandboxRoot: '/tmp/sbx' }));
		expect(value(args, '--allowedTools')).toBe('Read,Grep,Glob,Edit,Write');
		expect(value(args, '--permission-mode')).toBe('acceptEdits');
	});

	it('disallows the network and the shell in every mode', () => {
		for (const settings of [READ_ONLY, WITH_TOOLS]) {
			const disallowed = value(buildArgs(request({ settings, sandboxRoot: '/tmp/sbx' })).args, '--disallowedTools') ?? '';
			for (const tool of ['Bash', 'WebFetch', 'WebSearch', 'Task']) expect(disallowed).toContain(tool);
		}
	});

	it('carries the model, effort and budget the user chose', () => {
		const { args } = buildArgs(request({ settings: { ...READ_ONLY, model: 'claude-opus-5', effort: 'xhigh' } }));
		expect(value(args, '--model')).toBe('claude-opus-5');
		expect(value(args, '--effort')).toBe('xhigh');
		expect(value(args, '--max-budget-usd')).toBe('0.25');
	});

	it('asks for JSON and does not persist a session', () => {
		const { args } = buildArgs(request());
		expect(value(args, '--output-format')).toBe('json');
		expect(args).toContain('--no-session-persistence');
	});

	it('passes a schema only when one was asked for', () => {
		expect(buildArgs(request()).args).not.toContain('--json-schema');
		const { args } = buildArgs(request({ jsonSchema: { type: 'object' } }));
		expect(value(args, '--json-schema')).toBe('{"type":"object"}');
	});
});

describe('runClaude against a fake executable', () => {
	const deps = (executable: string) => ({ executable, vaultPath: VAULT, maxOutputBytes: 1024 * 1024 });

	it('returns the model text and what it cost', async () => {
		const executable = await fakeClaude('{"result":"Three things are scheduled.","total_cost_usd":0.0123}');
		const result = await runClaude({ prompt: 'x', settings: READ_ONLY }, deps(executable));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.text).toBe('Three things are scheduled.');
			expect(result.costUsd).toBeCloseTo(0.0123, 6);
		}
	});

	it('refuses before spawning when the sandbox would be the vault', async () => {
		const executable = await fakeClaude('{"result":"should never run"}');
		const result = await runClaude(
			{ prompt: 'x', settings: WITH_TOOLS, sandboxRoot: VAULT },
			deps(executable)
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('refused');
			expect(result.refusals[0].guardrail).toBe('G3');
		}
	});

	it('refuses a tool run with no sandbox at all', async () => {
		const executable = await fakeClaude('{"result":"should never run"}');
		const result = await runClaude({ prompt: 'x', settings: WITH_TOOLS }, deps(executable));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('refused');
	});

	it('reports bad JSON rather than throwing', async () => {
		const executable = await fakeClaude('Sure! Here is my answer, in prose.');
		const result = await runClaude({ prompt: 'x', settings: READ_ONLY }, deps(executable));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('bad-json');
	});

	it('reports a non-zero exit rather than throwing', async () => {
		const executable = await fakeClaude('{"result":"x"}', 3);
		const result = await runClaude({ prompt: 'x', settings: READ_ONLY }, deps(executable));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('exit');
	});

	it('reports a missing executable rather than throwing', async () => {
		const result = await runClaude({ prompt: 'x', settings: READ_ONLY }, deps(join(scratch, 'not-here')));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('spawn-failed');
	});

	it('kills a run that says too much', async () => {
		const path = join(scratch, 'chatty');
		await writeFile(path, '#!/bin/sh\nwhile true; do echo "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; done\n', 'utf8');
		await chmod(path, 0o755);
		const result = await runClaude(
			{ prompt: 'x', settings: READ_ONLY },
			{ executable: path, vaultPath: VAULT, maxOutputBytes: 2048 }
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('too-large');
	});

	it('kills a run that takes too long', async () => {
		const path = join(scratch, 'slow');
		await writeFile(path, '#!/bin/sh\nsleep 30\n', 'utf8');
		await chmod(path, 0o755);
		const result = await runClaude(
			{ prompt: 'x', settings: { ...READ_ONLY, timeoutSeconds: 0.3 } },
			{ executable: path, vaultPath: VAULT }
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('timeout');
	});

	it('hands the prompt to the process as an argument, with no shell in between', async () => {
		const record = join(scratch, 'prompt.txt');
		const path = join(scratch, 'record-args');
		await writeFile(path, `#!/bin/sh\nprintf '%s' "$2" > ${record}\necho '{"result":"ok"}'\n`, 'utf8');
		await chmod(path, 0o755);
		const prompt = 'weird "quotes" and $(whoami) and `backticks`';
		const result = await runClaude({ prompt, settings: READ_ONLY }, deps(path));
		expect(result.ok).toBe(true);
		// Verbatim: nothing expanded, nothing quoted away.
		expect(await readFile(record, 'utf8')).toBe(prompt);
	});
});

describe('parseOutput', () => {
	it('takes the text from result, text, or a bare string', () => {
		expect((parseOutput('{"result":"a"}', 0) as { text: string }).text).toBe('a');
		expect((parseOutput('{"text":"b"}', 0) as { text: string }).text).toBe('b');
		expect((parseOutput('"c"', 0) as { text: string }).text).toBe('c');
	});

	it('takes the cost from either spelling, and zero when it is absent', () => {
		expect((parseOutput('{"result":"a","cost_usd":0.5}', 0) as { costUsd: number }).costUsd).toBe(0.5);
		expect((parseOutput('{"result":"a"}', 0) as { costUsd: number }).costUsd).toBe(0);
	});

	it('pulls JSON out of a fenced block, for a structured feature', () => {
		const out = parseOutput('{"result":"```json\\n{\\"path\\":\\"a.md\\"}\\n```"}', 0);
		expect(out.ok).toBe(true);
		if (out.ok) expect(out.json).toEqual({ path: 'a.md' });
	});

	it('treats an error envelope as a failure', () => {
		expect(parseOutput('{"is_error":true,"error":"budget exceeded"}', 0).ok).toBe(false);
	});

	it('treats empty output as a failure rather than an empty answer', () => {
		expect(parseOutput('   ', 0).ok).toBe(false);
	});
});
