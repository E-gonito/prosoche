import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { NoteIndex } from '../index/index';
import { dailyNotePath, today } from '../daily';
import { ask, factsLabel } from './ask';
import { gatherWorkspaceFacts, renderFacts } from './facts';
import { defaultSettings, saveSettings } from './settings';
import type { Workspace } from '../workspaces';

/**
 * What the model is actually sent, which is the whole point of the facts
 * block and the one thing no other test can see. The CLI is a shell script
 * that writes its arguments to a file and prints a canned answer, so the
 * prompt and the system prompt can be read back exactly as they were handed
 * over - the same trick `cli.test.ts` uses, for the same reason.
 */
let root: string;
let scratch: string;
let vault: Vault;
let index: NoteIndex;
let record: string;
let executable: string;

const DAY = today();
const DECK = 'Work Projects/eye2gene/Tasks.md';

const EYE2GENE: Workspace = {
	slug: 'eye2gene',
	name: 'eye2gene',
	color: '#2f6fed',
	tag: 'ws/eye2gene',
	aliases: ['eye2gene'],
	folders: ['Work Projects/eye2gene'],
	template: 'project',
	tabs: [],
	deck: DECK,
	kanbanColumns: [],
	path: '_hub/workspaces/eye2gene.md'
};

async function add(path: string, content: string, mtimeMs = 1000): Promise<void> {
	await vault.write(path, content);
	index.put(path, content, mtimeMs);
}

/** Everything the CLI was given, as one string. */
const given = (): Promise<string> => readFile(record, 'utf8');

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-ask-vault-'));
	scratch = await mkdtemp(join(tmpdir(), 'hub-ask-cli-'));
	vault = new Vault(root);
	index = new NoteIndex(':memory:');

	record = join(scratch, 'given.txt');
	executable = join(scratch, 'fake-claude');
	await writeFile(
		executable,
		`#!/bin/sh\nprintf '%s\\n' "$@" > ${record}\necho '{"result":"The importer took most of it.","total_cost_usd":0.01}'\n`,
		'utf8'
	);
	await chmod(executable, 0o755);

	await saveSettings(vault, { ...defaultSettings(), enabled: true });
	await add(DECK, '# Tasks\n- [ ] Fix the importer 📅 2026-09-20 `Q1`\n- [/] Rework the schema `Q2`\n', 3000);
	await add(
		'Work Projects/eye2gene/Spec.md',
		'# Spec\n\n## What does the importer do?\n\nIt reads the portal exports and writes one note per case.\n',
		2000
	);
	await add(dailyNotePath(DAY), `# Tasks\n- [x] 10:30 - 12:00 Work on eye2gene \`Q1\`\n`);
});

afterEach(async () => {
	index.close();
	await vault.close();
	await rm(root, { recursive: true, force: true });
	await rm(scratch, { recursive: true, force: true });
});

const run = (question: string, scope: Parameters<typeof ask>[1]['scope']) =>
	ask(
		{ vault, index, workspaces: [EYE2GENE] },
		{ question, scope, feature: 'ask' },
		{ executable, vaultPath: root }
	);

describe('ask, with the figures', () => {
	it('sends a workspace question the computed facts, inside the data wrapper', async () => {
		const answer = await run('Where did my eye2gene time go this week?', {
			kind: 'workspace',
			slug: 'eye2gene'
		});
		expect(answer.problem).toBeUndefined();

		const sent = await given();
		const expected = renderFacts(
			await gatherWorkspaceFacts({ vault, index, workspaces: [EYE2GENE] }, EYE2GENE, DAY)
		);
		expect(sent).toContain(expected.trim());
		// G8's envelope, with the block labelled as computed rather than quoted.
		expect(sent).toContain(`<note-content path="${factsLabel(DAY)}">`);
		expect(sent).toContain('1h30m done');
	});

	it('tells the model the first passage is computed, not quoted', async () => {
		await run('Where did my eye2gene time go this week?', { kind: 'workspace', slug: 'eye2gene' });
		const sent = await given();
		expect(sent).toContain('--append-system-prompt');
		expect(sent).toContain('figures this app computed from the notes today');
		expect(sent).toContain('(computed from your notes)');
	});

	it('never cites the figures as a note, since there is no note to open', async () => {
		const answer = await run('Where did my eye2gene time go this week?', {
			kind: 'workspace',
			slug: 'eye2gene'
		});
		expect(answer.citations.map((c) => c.path)).not.toContain(factsLabel(DAY));
		expect(answer.citations.every((c) => c.path.endsWith('.md'))).toBe(true);
	});

	it('sends no figures for a vault question, which has no week to sum', async () => {
		await run('What does the importer do?', { kind: 'vault' });
		const sent = await given();
		expect(sent).not.toContain('computed from your notes');
		expect(sent).not.toContain('figures this app computed');
		// The notes themselves still arrive, so this is a narrower prompt and
		// not an empty one.
		expect(sent).toContain('It reads the portal exports');
	});

	it('sends no figures for a workspace nobody has, rather than the whole vault', async () => {
		const answer = await run('What is going on?', { kind: 'workspace', slug: 'gone' });
		const sent = await given();
		expect(sent).not.toContain('computed from your notes');
		expect(answer.problem).toBeUndefined();
	});
});
