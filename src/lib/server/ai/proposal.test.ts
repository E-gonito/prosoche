import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { apply, markerBlock, newId, policyFor, readRegion, replaceRegion, undo, validate, type Policy } from './proposal';
import { DEFAULT_BLAST } from './guardrails';
import type { Proposal, ProposalEdit, RunStamp } from '$lib/shared/ai';

const STAMP: RunStamp = {
	model: 'claude-sonnet-5',
	effort: 'medium',
	permission: 'propose',
	budgetUsd: 0.25,
	timeoutSeconds: 90,
	feature: 'capture',
	startedAt: '2026-09-21T09:00:00.000Z',
	durationMs: 1200,
	costUsd: 0.01
};

let root: string;
let undoRoot: string;
let vault: Vault;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-ai-prop-'));
	undoRoot = await mkdtemp(join(tmpdir(), 'hub-ai-undo-'));
	vault = new Vault(root);
	await vault.write('Inbox/Capture.md', '# Capture\n\n- one\n- two\n');
});
afterEach(async () => {
	await vault.close();
	await rm(root, { recursive: true, force: true });
	await rm(undoRoot, { recursive: true, force: true });
});

const policy = (over: Partial<Policy> = {}): Policy => ({
	enabled: true,
	path: { feature: 'capture', allow: ['Inbox/'] },
	blast: { ...DEFAULT_BLAST },
	...over
});

let seq = 0;
const proposal = (edits: ProposalEdit[], over: Partial<Proposal> = {}): Proposal => ({
	id: `p${++seq}-${Date.now()}`,
	feature: 'capture',
	stamp: STAMP,
	summary: 'a change',
	edits,
	accepted: [],
	...over
});

describe('validate', () => {
	it('approves an append inside the allowlist', async () => {
		const p = proposal([{ id: 'e1', kind: 'append', path: 'Inbox/Capture.md', text: '- three', reason: 'filing' }]);
		const result = await validate(vault, p, policy());
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.previews[0].after).toBe('# Capture\n\n- one\n- two\n- three\n');
	});

	it('refuses a path outside the allowlist, naming G4', async () => {
		const p = proposal([{ id: 'e1', kind: 'append', path: 'Work/Secret.md', text: 'x', reason: 'r' }]);
		const result = await validate(vault, p, policy());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusals[0].guardrail).toBe('G4');
	});

	it('refuses everything when the kill switch is off', async () => {
		const p = proposal([{ id: 'e1', kind: 'append', path: 'Inbox/Capture.md', text: 'x', reason: 'r' }]);
		const result = await validate(vault, p, policy({ enabled: false }));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusals.some((r) => r.guardrail === 'G10')).toBe(true);
	});

	it('refuses creating a note that already exists', async () => {
		const p = proposal([{ id: 'e1', kind: 'create', path: 'Inbox/Capture.md', text: 'replacement', reason: 'r' }]);
		const result = await validate(vault, p, policy());
		expect(result.ok).toBe(false);
	});

	it('creates a note that does not exist', async () => {
		const p = proposal([{ id: 'e1', kind: 'create', path: 'Inbox/New.md', text: '# New', reason: 'r' }]);
		const result = await validate(vault, p, policy());
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.previews[0].after).toBe('# New\n');
	});

	it('refuses a rewrite-task whose line has moved underneath', async () => {
		await vault.write('Inbox/Tasks.md', '# Tasks\n- [ ] Buy milk `Q2`\n');
		const p = proposal([
			{
				id: 'e1',
				kind: 'rewrite-task',
				path: 'Inbox/Tasks.md',
				line: 1,
				expectedRaw: '- [ ] Buy bread `Q2`',
				edit: { status: 'done' },
				reason: 'done'
			}
		]);
		const result = await validate(vault, p, policy());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusals[0].guardrail).toBe('G6');
	});

	it('rewrites one task line and leaves every other byte alone', async () => {
		const before = '# Tasks\n- [ ] Buy milk `Q2`\n\ttrailing note\n- [ ] Other\n';
		await vault.write('Inbox/Tasks.md', before);
		const p = proposal([
			{
				id: 'e1',
				kind: 'rewrite-task',
				path: 'Inbox/Tasks.md',
				line: 1,
				expectedRaw: '- [ ] Buy milk `Q2`',
				edit: { status: 'done' },
				reason: 'done'
			}
		]);
		const result = await validate(vault, p, policy());
		expect(result.ok).toBe(true);
		if (result.ok) {
			const after = result.previews[0].after.split('\n');
			expect(after[0]).toBe('# Tasks');
			expect(after[1]).toContain('- [x]');
			expect(after.slice(2)).toEqual(before.split('\n').slice(2));
		}
	});

	it('refuses a move, because the vault has no rename', async () => {
		const p = proposal([{ id: 'e1', kind: 'move', path: 'Inbox/Capture.md', to: 'Inbox/Filed.md', reason: 'tidy' }]);
		const result = await validate(vault, p, policy());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusals[0].message).toContain('not supported');
	});

	it('shows the previews even when it refuses, so the user can see what was stopped', async () => {
		const p = proposal([{ id: 'e1', kind: 'append', path: 'Work/Secret.md', text: 'x', reason: 'r' }]);
		const result = await validate(vault, p, policy());
		expect(result.previews).toHaveLength(1);
		expect(result.previews[0].refusals).not.toEqual([]);
	});
});

describe('apply', () => {
	const accepted = (edits: ProposalEdit[]) => proposal(edits, { accepted: edits.map((e) => e.id) });
	/** The temp vault and a temp undo store, so a test never touches the real ones. */
	const run = (p: Proposal, ids?: string[], pol: Policy = policy()) =>
		apply(vault, p, pol, { accepted: ids, vaultPath: root, undoPath: undoRoot });

	it('writes nothing when nothing was accepted', async () => {
		const p = proposal([{ id: 'e1', kind: 'append', path: 'Inbox/Capture.md', text: '- three', reason: 'r' }]);
		const result = await run(p, []);
		expect(result.written).toEqual([]);
		expect((await vault.read('Inbox/Capture.md')).content).toBe('# Capture\n\n- one\n- two\n');
	});

	it('writes exactly the accepted edit', async () => {
		const p = accepted([{ id: 'e1', kind: 'append', path: 'Inbox/Capture.md', text: '- three', reason: 'r' }]);
		const result = await run(p);
		expect(result.written).toEqual(['Inbox/Capture.md']);
		expect((await vault.read('Inbox/Capture.md')).content).toBe('# Capture\n\n- one\n- two\n- three\n');
	});

	it('writes only the accepted half of a proposal', async () => {
		const p = proposal([
			{ id: 'good', kind: 'append', path: 'Inbox/Capture.md', text: '- three', reason: 'r' },
			{ id: 'skip', kind: 'create', path: 'Inbox/Other.md', text: 'unwanted', reason: 'r' }
		]);
		const result = await run(p, ['good']);
		expect(result.written).toEqual(['Inbox/Capture.md']);
		expect((await vault.read('Inbox/Other.md')).exists).toBe(false);
	});

	it('is safe to call twice', async () => {
		const p = accepted([{ id: 'e1', kind: 'append', path: 'Inbox/Capture.md', text: '- three', reason: 'r' }]);
		await run(p);
		const second = await run(p);
		expect((await vault.read('Inbox/Capture.md')).content).toBe('# Capture\n\n- one\n- two\n- three\n');
		expect(second.written).toEqual(['Inbox/Capture.md']);
	});

	it('writes nothing when the kill switch is off', async () => {
		const p = accepted([{ id: 'e1', kind: 'append', path: 'Inbox/Capture.md', text: '- three', reason: 'r' }]);
		const result = await run(p, undefined, policy({ enabled: false }));
		expect(result.written).toEqual([]);
		expect(result.refusals[0].guardrail).toBe('G10');
	});

	it('writes nothing when a guardrail refuses, even for an accepted edit', async () => {
		const p = accepted([{ id: 'e1', kind: 'append', path: '../escape.md', text: 'x', reason: 'r' }]);
		const result = await run(p);
		expect(result.written).toEqual([]);
		expect(result.refusals.some((r) => r.guardrail === 'G4')).toBe(true);
	});

	it('takes an undo snapshot before writing, and can put the file back', async () => {
		const p = accepted([{ id: 'e1', kind: 'append', path: 'Inbox/Capture.md', text: '- three', reason: 'r' }]);
		const result = await run(p);
		expect(result.undoId).not.toBeNull();

		const restored = await undo(vault, result.undoId!, undoRoot);
		expect(restored.restored).toEqual(['Inbox/Capture.md']);
		expect((await vault.read('Inbox/Capture.md')).content).toBe('# Capture\n\n- one\n- two\n');
	});

	it('leaves a created note alone on undo rather than deleting it', async () => {
		const p = accepted([{ id: 'e1', kind: 'create', path: 'Inbox/New.md', text: 'new', reason: 'r' }]);
		const result = await run(p);
		const restored = await undo(vault, result.undoId!, undoRoot);
		expect(restored.skipped).toEqual(['Inbox/New.md']);
		expect((await vault.read('Inbox/New.md')).exists).toBe(true);
	});

	it('reports a conflict rather than overwriting a note changed underneath', async () => {
		const p = accepted([{ id: 'e1', kind: 'append', path: 'Inbox/Capture.md', text: '- three', reason: 'r' }]);
		// Two proposals racing: the second was resolved against the older file.
		const stale = accepted([{ id: 'e2', kind: 'append', path: 'Inbox/Capture.md', text: '- four', reason: 'r' }]);
		await run(p);
		const result = await run(stale);
		// The second resolves afresh, so it appends to the new content.
		expect((await vault.read('Inbox/Capture.md')).content).toBe('# Capture\n\n- one\n- two\n- three\n- four\n');
		expect(result.written).toEqual(['Inbox/Capture.md']);
	});
});

describe('replaceRegion', () => {
	const NOTE = [
		'---',
		'date: 2026-09-21',
		'---',
		'# My day',
		'',
		'Something I wrote myself, with `code` and a [[link]].',
		'',
		'## Briefing',
		'<!-- hub:briefing start -->',
		'yesterday’s briefing',
		'<!-- hub:briefing end -->',
		'',
		'## Notes',
		'\tindented, trailing spaces below   ',
		'   ',
		''
	].join('\n');

	it('replaces only the text between the markers', () => {
		const after = replaceRegion(NOTE, 'hub:briefing', 'today’s briefing');
		expect(after).not.toBeNull();
		expect(after).toContain('today’s briefing');
		expect(after).not.toContain('yesterday’s briefing');
	});

	it('leaves every byte outside the region exactly as it was', () => {
		const after = replaceRegion(NOTE, 'hub:briefing', 'new text')!;
		const head = NOTE.slice(0, NOTE.indexOf('<!-- hub:briefing start -->'));
		const tail = NOTE.slice(NOTE.indexOf('<!-- hub:briefing end -->') + '<!-- hub:briefing end -->'.length);
		expect(after.startsWith(head)).toBe(true);
		expect(after.endsWith(tail)).toBe(true);
	});

	it('is idempotent for the same body', () => {
		const once = replaceRegion(NOTE, 'hub:briefing', 'same')!;
		expect(replaceRegion(once, 'hub:briefing', 'same')).toBe(once);
	});

	it('handles a multi-line body without disturbing the markers', () => {
		const after = replaceRegion(NOTE, 'hub:briefing', '**Scheduled**\n- 09:00 a thing')!;
		expect(after.match(/hub:briefing start/g)).toHaveLength(1);
		expect(after.match(/hub:briefing end/g)).toHaveLength(1);
		expect(after).toContain('- 09:00 a thing');
	});

	it('returns null when the markers are absent, rather than guessing', () => {
		expect(replaceRegion('# Just a note\n', 'hub:briefing', 'x')).toBeNull();
	});

	it('will not match a marker belonging to something else', () => {
		const other = '<!-- hub:timesheet start -->\nx\n<!-- hub:timesheet end -->';
		expect(replaceRegion(other, 'hub:briefing', 'y')).toBeNull();
	});

	it('reads the current region back', () => {
		expect(readRegion(NOTE, 'hub:briefing')).toBe('yesterday’s briefing');
		expect(readRegion('# nothing', 'hub:briefing')).toBeNull();
	});

	it('renders the marker pair for a note that has none', () => {
		expect(markerBlock('hub:briefing')).toBe('<!-- hub:briefing start -->\n<!-- hub:briefing end -->');
	});
});

describe('newId', () => {
	it('sorts by time and does not repeat within a run', () => {
		const a = newId('p', new Date('2026-09-21T09:00:00Z'));
		const b = newId('p', new Date('2026-09-21T09:00:00Z'));
		expect(a).not.toBe(b);
		expect(a.startsWith('p-20260921T090000')).toBe(true);
	});
});

describe('policyFor', () => {
	const caps = { enabled: true, blast: { maxFiles: 5, maxLineLoss: 0.3 } };
	const ctx = { today: '2026-09-21' };

	it('lets the read-only features write nothing at all', () => {
		expect(policyFor('ask', caps, ctx).path.allow).toEqual([]);
		expect(policyFor('insights', caps, ctx).path.allow).toEqual([]);
	});

	it('holds the briefing to today\'s note alone', () => {
		const policy = policyFor('briefing', caps, ctx);
		expect(policy.path.allow).toEqual(['Journal/2026/09/21.md']);
		expect(policy.blast.writableDays).toEqual(['2026-09-21']);
		expect(policy.blast.renamableUnder).toEqual([]);
	});

	it('lets capture write the inbox and the one destination it proposed', () => {
		const policy = policyFor('capture', caps, { ...ctx, destinations: ['Work/Tasks.md'] });
		expect(policy.path.allow).toEqual(['Inbox/', 'Work/Tasks.md']);
		expect(policy.blast.maxFiles).toBe(2);
	});

	it('lets the ordinary features touch today and yesterday, and no other day', () => {
		expect(policyFor('capture', caps, ctx).blast.writableDays).toEqual(['2026-09-21', '2026-09-20']);
	});

	it('carries the kill switch through, so one flag reaches every check', () => {
		expect(policyFor('ask', { ...caps, enabled: false }, ctx).enabled).toBe(false);
	});

	it('gives a feature it has never heard of nothing', () => {
		expect(policyFor('not-a-feature' as never, caps, ctx).path.allow).toEqual([]);
	});
});
