import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { logPath, logRun, recentRuns, row, spentOn, type AuditEntry } from './audit';

let root: string;
let vault: Vault;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-ai-audit-'));
	vault = new Vault(root);
});
afterEach(async () => {
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
	at: '2026-09-21T09:15:00.000Z',
	feature: 'ask',
	model: 'claude-sonnet-5',
	effort: 'medium',
	permission: 'read-only',
	paths: ['Work/Deployment.md'],
	decision: 'answered',
	guardrails: [],
	costUsd: 0.0123,
	durationMs: 3400,
	note: 'what is the rollback plan?',
	...over
});

describe('logPath', () => {
	it('is one file a month, in the vault', () => {
		expect(logPath('2026-09-21T09:15:00.000Z')).toBe('_hub/ai-log/2026-09.md');
	});
});

describe('logRun', () => {
	it('creates the month file with a heading and a table header', async () => {
		await logRun(vault, entry());
		const note = await vault.read('_hub/ai-log/2026-09.md');
		expect(note.content).toContain('# AI runs, 2026-09');
		expect(note.content).toContain('| Time | Feature | Model |');
	});

	it('records the model, effort, mode, paths, decision and cost', async () => {
		await logRun(vault, entry());
		const content = (await vault.read('_hub/ai-log/2026-09.md')).content;
		expect(content).toContain('claude-sonnet-5');
		expect(content).toContain('medium');
		expect(content).toContain('read-only');
		expect(content).toContain('Work/Deployment.md');
		expect(content).toContain('answered');
		expect(content).toContain('$0.0123');
		expect(content).toContain('09:15');
	});

	it('logs a refused run too, naming the guardrails that fired', async () => {
		await logRun(vault, entry({ decision: 'refused', guardrails: ['G4', 'G10'], costUsd: 0, note: 'path refused' }));
		const content = (await vault.read('_hub/ai-log/2026-09.md')).content;
		expect(content).toContain('refused');
		expect(content).toContain('G4 G10');
	});

	it('appends rather than replacing', async () => {
		await logRun(vault, entry());
		await logRun(vault, entry({ at: '2026-09-21T10:00:00.000Z', note: 'second' }));
		const content = (await vault.read('_hub/ai-log/2026-09.md')).content;
		expect(content.split('\n').filter((l) => l.startsWith('| 09:15') || l.startsWith('| 10:00'))).toHaveLength(2);
	});

	it('starts a new file for a new month', async () => {
		await logRun(vault, entry());
		await logRun(vault, entry({ at: '2026-10-01T08:00:00.000Z' }));
		expect((await vault.read('_hub/ai-log/2026-10.md')).exists).toBe(true);
	});
});

describe('row', () => {
	it('escapes a pipe rather than letting it split the row', () => {
		expect(row(entry({ note: 'grep "a|b"' }))).toContain('grep "a\\|b"');
	});

	it('flattens a newline, which would otherwise end the row', () => {
		expect(row(entry({ note: 'line one\nline two' }))).not.toContain('\n');
	});

	it('shows a dash rather than an empty cell when no file was touched', () => {
		expect(row(entry({ paths: [] }))).toContain('| - |');
	});
});

describe('spentOn', () => {
	it('is zero for a vault where nothing has run', async () => {
		expect(await spentOn(vault, '2026-09-21')).toEqual({ usd: 0, runs: 0 });
	});

	it('adds up the day, which is what the budget guardrail reads', async () => {
		await logRun(vault, entry({ costUsd: 0.1 }));
		await logRun(vault, entry({ at: '2026-09-21T10:00:00.000Z', costUsd: 0.25 }));
		const spend = await spentOn(vault, '2026-09-21');
		expect(spend.usd).toBeCloseTo(0.35, 6);
		expect(spend.runs).toBe(2);
	});

	it('ignores a row it cannot parse instead of breaking the sum', async () => {
		await logRun(vault, entry({ costUsd: 0.5 }));
		const note = await vault.read('_hub/ai-log/2026-09.md');
		await vault.write(note.path, `${note.content}| someone | typed | this | by | hand |\n`);
		expect((await spentOn(vault, '2026-09-21')).usd).toBeCloseTo(0.5, 6);
	});

	it('survives the file being written to by a person', async () => {
		await vault.write('_hub/ai-log/2026-09.md', '# AI runs\n\nI deleted the table.\n');
		expect(await spentOn(vault, '2026-09-21')).toEqual({ usd: 0, runs: 0 });
	});
});

describe('recentRuns', () => {
	it('gives the newest first, without the header', async () => {
		await logRun(vault, entry({ note: 'first' }));
		await logRun(vault, entry({ at: '2026-09-21T10:00:00.000Z', note: 'second' }));
		const rows = await recentRuns(vault, '2026-09-21');
		expect(rows).toHaveLength(2);
		expect(rows[0]).toContain('second');
	});

	it('is empty for a month with no log', async () => {
		expect(await recentRuns(vault, '2026-01-01')).toEqual([]);
	});
});
