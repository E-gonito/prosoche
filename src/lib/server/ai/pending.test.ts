import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { PENDING_PATH, dequeue, enqueue, pending, pendingById } from './pending';
import { checkPath } from './guardrails';
import type { Proposal, RunStamp } from '$lib/shared/ai';

const STAMP: RunStamp = {
	model: 'claude-sonnet-5',
	effort: 'medium',
	permission: 'propose',
	budgetUsd: 0.25,
	timeoutSeconds: 120,
	feature: 'weekly-review',
	startedAt: '2026-09-20T18:00:00.000Z',
	durationMs: 1000,
	costUsd: 0.05
};

const make = (id: string, at = STAMP.startedAt): Proposal => ({
	id,
	feature: 'weekly-review',
	stamp: { ...STAMP, startedAt: at },
	summary: `summary of ${id}`,
	edits: [{ id: `${id}-e1`, kind: 'create', path: 'Journal/Weekly/2026-W38.md', text: 'x\n', reason: 'new note' }],
	accepted: []
});

describe('the pending queue', () => {
	let dir: string;
	let vault: Vault;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'pending-'));
		vault = new Vault(dir);
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('is empty before anything is queued', async () => {
		expect(await pending(vault)).toEqual([]);
	});

	it('keeps what was queued, newest first', async () => {
		await enqueue(vault, make('a', '2026-09-18T18:00:00.000Z'));
		await enqueue(vault, make('b', '2026-09-20T18:00:00.000Z'));
		expect((await pending(vault)).map((p) => p.id)).toEqual(['b', 'a']);
	});

	it('replaces rather than duplicates a job that ran twice', async () => {
		await enqueue(vault, make('a'));
		await enqueue(vault, { ...make('a'), summary: 'the newer figures' });
		const queue = await pending(vault);
		expect(queue).toHaveLength(1);
		expect(queue[0].summary).toBe('the newer figures');
	});

	it('finds one by id and forgets it when dismissed', async () => {
		await enqueue(vault, make('a'));
		expect(await pendingById(vault, 'a')).not.toBeNull();
		expect(await dequeue(vault, 'a')).toBe(true);
		expect(await pendingById(vault, 'a')).toBeNull();
	});

	it('treats dismissing something already gone as success', async () => {
		expect(await dequeue(vault, 'nothing')).toBe(false);
		expect(await pending(vault)).toEqual([]);
	});

	it('reads a corrupt file as an empty queue rather than throwing', async () => {
		await vault.write(PENDING_PATH, '{oh no');
		expect(await pending(vault)).toEqual([]);
	});

	it('drops entries that are not proposals', async () => {
		await vault.write(PENDING_PATH, JSON.stringify([make('a'), null, 3, { id: 'x' }]));
		expect((await pending(vault)).map((p) => p.id)).toEqual(['a']);
	});

	it('keeps 20 and no more, so a year of Sundays is not held in one file', async () => {
		for (let i = 0; i < 25; i++) await enqueue(vault, make(`p${i}`));
		expect(await pending(vault)).toHaveLength(20);
	});

	it('is a path no AI feature may write', () => {
		// The queue decides what gets written, so a model that could edit it
		// would be able to enqueue work for itself.
		for (const feature of ['briefing', 'weekly-review', 'capture'] as const) {
			expect(checkPath(PENDING_PATH, { feature, allow: [PENDING_PATH, '_hub/', 'Journal/'] })).not.toEqual([]);
		}
	});
});
