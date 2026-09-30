import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { defaultSettings, saveSettings } from './settings';
import { buildPrompt, runDatingInsights } from './dating-insights';
import { logPath } from './audit';
import type { InsightsSource } from '../dating';

const SOURCE: InsightsSource = {
	asOf: '2026-09-29',
	ledger: [
		{ day: '2026-09-28', counts: { sent: 10, matches: 3, type: 1, received: 2 }, notes: 'slow day' },
		{ day: '2026-09-29', counts: { sent: 8, matches: 2, type: 2, received: 0 }, notes: '' }
	],
	people: [
		{
			name: 'Ada',
			stage: 'dating',
			dates: [{ line: 0, day: '2026-09-20', text: 'Coffee at Monmouth', rating: 4, cost: 9, notes: 'easy conversation', raw: '' }]
		}
	]
};

describe('buildPrompt', () => {
	it('contains only what was passed: the ledger days and each person, nothing else', () => {
		const prompt = buildPrompt(SOURCE);
		expect(prompt).toContain('2026-09-28 sent 10, matches 3, type 1, received 2 — slow day');
		expect(prompt).toContain('2026-09-29 sent 8, matches 2, type 2, received 0');
		expect(prompt).toContain('Person: Ada');
		expect(prompt).toContain('Stage: dating');
		expect(prompt).toContain('2026-09-20 Coffee at Monmouth rating 4 cost 9 — easy conversation');
	});

	it('says so plainly when there are no logged days', () => {
		expect(buildPrompt({ asOf: '2026-09-29', ledger: [], people: [] })).toContain('No days logged yet.');
	});

	it('states the match-rate definition, matching the artifact\'s own caution', () => {
		expect(buildPrompt(SOURCE)).toMatch(/matches from the user's own likes/);
	});
});

describe('runDatingInsights', () => {
	let root: string;
	let scratch: string;
	let vault: Vault;
	let record: string;
	let executable: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-dating-insights-vault-'));
		scratch = await mkdtemp(join(tmpdir(), 'hub-dating-insights-cli-'));
		vault = new Vault(root);

		record = join(scratch, 'given.txt');
		executable = join(scratch, 'fake-claude');
		await writeFile(
			executable,
			`#!/bin/sh\nprintf '%s\\n' "$@" > ${record}\necho '{"result":"A steady week; Ada looks promising.","total_cost_usd":0.01}'\n`,
			'utf8'
		);
		await chmod(executable, 0o755);
	});

	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
		await rm(scratch, { recursive: true, force: true });
	});

	it('answers when AI is enabled, and logs no dating path or content', async () => {
		await saveSettings(vault, { ...defaultSettings(), enabled: true });
		const result = await runDatingInsights(vault, SOURCE, { executable });
		expect(result.problem).toBeNull();
		expect(result.text).toBe('A steady week; Ada looks promising.');

		const log = await vault.read(logPath(new Date().toISOString()));
		expect(log.content).not.toContain('Private');
		expect(log.content).not.toContain('Ada');
		expect(log.content).toContain('dating-insights');
	});

	it('sends the ledger and the dates log to the CLI, and nothing else', async () => {
		await saveSettings(vault, { ...defaultSettings(), enabled: true });
		await runDatingInsights(vault, SOURCE, { executable });
		const given = await readFile(record, 'utf8');
		expect(given).toContain('Coffee at Monmouth');
		expect(given).toContain('sent 10');
	});

	it('refuses calmly when AI is switched off', async () => {
		await saveSettings(vault, { ...defaultSettings(), enabled: false });
		const result = await runDatingInsights(vault, SOURCE, { executable });
		expect(result.text).toBe('');
		expect(result.problem).toMatch(/switched off/);
	});
});
