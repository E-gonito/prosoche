import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoteIndex } from '../index/index';
import { Vault } from '../vault/index';
import { CAPTURE_PATH } from '../capture';
import { destinations, fileCapture, propose } from './file-capture';
import { apply, policyFor, validate } from './proposal';
import { loadSettings } from './settings';
import type { RunStamp } from '$lib/shared/ai';
import type { Workspace } from '../workspaces';

const STAMP: RunStamp = {
	model: 'claude-haiku-4-5-20251001',
	effort: 'low',
	permission: 'propose',
	budgetUsd: 0.1,
	timeoutSeconds: 90,
	feature: 'capture',
	startedAt: '2026-09-21T10:00:00.000Z',
	durationMs: 800,
	costUsd: 0.001
};

const CAPTURE = [
	'# Capture',
	'',
	'## 2026-09-21',
	'- 09:12 Ask about the grading walkthrough',
	'- [ ] 09:20 Chase the QMS documents',
	''
].join('\n');
/** The plain bullet, which capture writes for anything that is not a task. */
const CAPTURE_LINE = 3;
/** The task line, which capture keeps as a task. */
const TASK_LINE = 4;

const WORKSPACE: Workspace = {
	slug: 'atlas',
	name: 'Atlas',
	color: '#2f6fed',
	tag: 'ws/atlas',
	aliases: [],
	folders: ['Work/Atlas'],
	template: '',
	tabs: [],
	deck: '',
	kanbanColumns: [],
	path: '_hub/workspaces/atlas.md'
};

describe('propose', () => {
	it('appends to the destination and strikes a task out of the Inbox', () => {
		const proposal = propose(
			CAPTURE_PATH,
			'- [ ] 09:20 Chase the QMS documents',
			TASK_LINE,
			{ destination: 'Work/Atlas/Questions.md', reason: 'it is an Atlas blocker' },
			STAMP
		);
		expect(proposal.edits.map((e) => e.kind)).toEqual(['append', 'rewrite-task']);
		expect(proposal.edits[0]).toMatchObject({
			path: 'Work/Atlas/Questions.md',
			text: '- Chase the QMS documents\n'
		});
		expect(proposal.edits[1]).toMatchObject({ path: CAPTURE_PATH, line: TASK_LINE });
		expect(proposal.accepted).toEqual([]);
	});

	it('only copies a plain bullet, because no edit kind rewrites an arbitrary line', () => {
		const proposal = propose(
			CAPTURE_PATH,
			'- 09:12 Ask about the grading walkthrough',
			CAPTURE_LINE,
			{ destination: 'Work/Atlas/Questions.md', reason: 'it is a question about Atlas' },
			STAMP
		);
		expect(proposal.edits.map((e) => e.kind)).toEqual(['append']);
		expect(proposal.summary).toContain('stays in the Inbox');
	});

	it('leaves the two edits separately acceptable', () => {
		const proposal = propose(CAPTURE_PATH, '- [ ] x', TASK_LINE, { destination: 'A.md', reason: 'r' }, STAMP);
		expect(new Set(proposal.edits.map((e) => e.id)).size).toBe(2);
	});

	it('strips the bullet and the arrival time but nothing else', () => {
		const proposal = propose(
			CAPTURE_PATH,
			'- 09:12 10:30 stand-up, ask about 09:00 slot',
			CAPTURE_LINE,
			{ destination: 'A.md', reason: 'r' },
			STAMP
		);
		const edit = proposal.edits[0];
		expect('text' in edit ? edit.text : '').toBe('- 10:30 stand-up, ask about 09:00 slot\n');
	});
});

describe('destinations', () => {
	let dir: string;
	let index: NoteIndex;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'capture-dest-'));
		index = new NoteIndex(':memory:');
	});
	afterEach(async () => {
		index.close();
		await rm(dir, { recursive: true, force: true });
	});

	it('offers the workspace folders and never the note it came from', () => {
		index.put('Work/Atlas/Questions.md', '# Questions\n', Date.now(), 'a');
		index.put('Work/Atlas/Notes.md', '# Notes\n', Date.now(), 'b');
		index.put('Personal/Shopping.md', '# Shopping\n', Date.now(), 'c');
		index.put(CAPTURE_PATH, CAPTURE, Date.now(), 'd');

		const found = destinations({ index, workspaces: [WORKSPACE] }, CAPTURE_PATH);
		expect(found).toEqual(['Work/Atlas/Notes.md', 'Work/Atlas/Questions.md']);
	});

	it('offers the whole vault when no workspace has folders', () => {
		index.put('Personal/Shopping.md', '# Shopping\n', Date.now(), 'c');
		index.put('_hub/workspaces/atlas.md', '# Atlas\n', Date.now(), 'e');
		const found = destinations({ index, workspaces: [] }, CAPTURE_PATH);
		expect(found).toEqual(['Personal/Shopping.md']);
	});
});

describe('fileCapture', () => {
	let dir: string;
	let scratch: string;
	let vault: Vault;
	let index: NoteIndex;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'capture-vault-'));
		scratch = await mkdtemp(join(tmpdir(), 'capture-cli-'));
		vault = new Vault(dir);
		index = new NoteIndex(':memory:');
		// The layer is off in a vault with no `_hub/ai.md`; these tests are
		// about what happens once it is on.
		await vault.write('_hub/ai.md', '---\nenabled: true\n---\n');
		await vault.write(CAPTURE_PATH, CAPTURE);
		index.put(CAPTURE_PATH, CAPTURE, Date.now(), 'd');
		await vault.write('Work/Atlas/Questions.md', '# Questions\n');
		index.put('Work/Atlas/Questions.md', '# Questions\n', Date.now(), 'a');
	});

	afterEach(async () => {
		index.close();
		await rm(dir, { recursive: true, force: true });
		await rm(scratch, { recursive: true, force: true });
	});

	async function fakeCli(result: unknown): Promise<string> {
		const path = join(scratch, 'fake-claude');
		const body = JSON.stringify({
			type: 'result',
			subtype: 'success',
			result: JSON.stringify(result),
			total_cost_usd: 0.001
		});
		await writeFile(path, `#!/bin/sh\ncat <<'JSON'\n${body}\nJSON\n`, 'utf8');
		await chmod(path, 0o755);
		return path;
	}

	const deps = () => ({ vault, index, workspaces: [WORKSPACE] });
	const raw = '- 09:12 Ask about the grading walkthrough';
	const taskRaw = '- [ ] 09:20 Chase the QMS documents';

	it('refuses a line that has changed since the page loaded', async () => {
		const result = await fileCapture(deps(), { line: CAPTURE_LINE, expectedRaw: '- 09:12 something else' });
		expect(result.proposal).toBeNull();
		expect(result.problem).toContain('changed since the page loaded');
	});

	it('refuses a line that is no longer there', async () => {
		const result = await fileCapture(deps(), { line: 900, expectedRaw: raw });
		expect(result.proposal).toBeNull();
		expect(result.problem).toContain('no longer in the note');
	});

	it('says so when there is nowhere to file anything', async () => {
		const bare = new NoteIndex(':memory:');
		bare.put(CAPTURE_PATH, CAPTURE, Date.now(), 'd');
		const result = await fileCapture(
			{ vault, index: bare, workspaces: [] },
			{ line: CAPTURE_LINE, expectedRaw: raw }
		);
		bare.close();
		expect(result.candidates).toEqual([]);
		expect(result.proposal).toBeNull();
		expect(result.problem).toBeNull();
	});

	it('refuses a destination it was not offered', async () => {
		const executable = await fakeCli({ destination: 'Work/Somewhere Nice.md', reason: 'felt right' });
		const result = await fileCapture(deps(), { line: CAPTURE_LINE, expectedRaw: raw }, { cli: { executable, vaultPath: dir } });
		expect(result.proposal).toBeNull();
		expect(result.problem).toContain('was not one of the options');
	});

	it('proposes the note it was offered, and writes nothing yet', async () => {
		const executable = await fakeCli({ destination: 'Work/Atlas/Questions.md', reason: 'a question about Atlas' });
		const result = await fileCapture(deps(), { line: CAPTURE_LINE, expectedRaw: raw }, { cli: { executable, vaultPath: dir } });

		expect(result.proposal?.edits[0]).toMatchObject({ path: 'Work/Atlas/Questions.md' });
		expect((await vault.read('Work/Atlas/Questions.md')).content).toBe('# Questions\n');
		expect((await vault.read(CAPTURE_PATH)).content).toBe(CAPTURE);
	});

	it('passes its own path policy, and only with the destination declared', async () => {
		const executable = await fakeCli({ destination: 'Work/Atlas/Questions.md', reason: 'a question about Atlas' });
		const { proposal } = await fileCapture(
			deps(),
			{ line: CAPTURE_LINE, expectedRaw: raw },
			{ cli: { executable, vaultPath: dir } }
		);
		const settings = await loadSettings(vault);

		const blind = policyFor('capture', settings, { today: '2026-09-21' });
		expect((await validate(vault, proposal!, blind)).ok).toBe(false);

		const told = policyFor('capture', settings, {
			today: '2026-09-21',
			destinations: ['Work/Atlas/Questions.md']
		});
		expect((await validate(vault, proposal!, told)).ok).toBe(true);
	});

	it('files a task and strikes it out when the user accepts both halves', async () => {
		const executable = await fakeCli({ destination: 'Work/Atlas/Questions.md', reason: 'an Atlas blocker' });
		const { proposal } = await fileCapture(
			deps(),
			{ line: TASK_LINE, expectedRaw: taskRaw },
			{ cli: { executable, vaultPath: dir } }
		);
		const settings = await loadSettings(vault);
		const policy = policyFor('capture', settings, {
			today: '2026-09-21',
			destinations: ['Work/Atlas/Questions.md']
		});

		const result = await apply(vault, proposal!, policy, {
			accepted: proposal!.edits.map((e) => e.id),
			vaultPath: dir,
			undoPath: join(scratch, 'undo')
		});

		expect(result.written.sort()).toEqual([CAPTURE_PATH, 'Work/Atlas/Questions.md']);
		expect((await vault.read('Work/Atlas/Questions.md')).content).toContain('Chase the QMS documents');
		const after = (await vault.read(CAPTURE_PATH)).content.split('\n');
		expect(after[TASK_LINE]).toContain('[-]');
		// Every other line, including the plain bullet above it, is untouched.
		expect(after.slice(0, TASK_LINE)).toEqual(CAPTURE.split('\n').slice(0, TASK_LINE));
	});

	it('leaves the capture alone when only the append is accepted', async () => {
		const executable = await fakeCli({ destination: 'Work/Atlas/Questions.md', reason: 'an Atlas blocker' });
		const { proposal } = await fileCapture(
			deps(),
			{ line: TASK_LINE, expectedRaw: taskRaw },
			{ cli: { executable, vaultPath: dir } }
		);
		const settings = await loadSettings(vault);
		const policy = policyFor('capture', settings, {
			today: '2026-09-21',
			destinations: ['Work/Atlas/Questions.md']
		});

		const result = await apply(vault, proposal!, policy, {
			accepted: [proposal!.edits[0].id],
			vaultPath: dir,
			undoPath: join(scratch, 'undo')
		});

		expect(result.written).toEqual(['Work/Atlas/Questions.md']);
		expect((await vault.read(CAPTURE_PATH)).content).toBe(CAPTURE);
	});
});
