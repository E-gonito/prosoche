import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { addStarters, loadLibrary } from '../tactics/index';
import { recordAar } from '../tactics/aar';
import { parseScenario } from '../parse/scenario';
import { generateProposal, readGenerateRequest, suggestProposal } from './tactics-drafts';
import { policyFor } from './proposal';
import { DEFAULT_BLAST } from './guardrails';
import type { RunStamp } from '$lib/shared/ai';

const stamp: RunStamp = {
	model: 'claude-sonnet-5-5',
	effort: 'medium',
	budgetUsd: 0.5,
	timeoutSeconds: 240,
	feature: 'tactics-generate',
	startedAt: '2026-10-20T12:00:00Z',
	durationMs: 1,
	costUsd: 0
};
const request = { game: 'bodycam' as const, tags: [], topic: '', count: 3 };
const good = {
	drill: 'hold-peek',
	situation: 'You hold a corridor and hear a step at the far door while reloading.',
	options: ['Finish the reload behind the corner', 'Peek now', 'Run across'],
	answer: 'A',
	tags: ['bodycam.reload'],
	difficulty: 2,
	time_limit_s: 6,
	why: 'Reloading exposed is a listed death.'
};

let dir: string;
let vault: Vault;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'tactics-drafts-'));
	vault = new Vault(dir);
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe('generateProposal', () => {
	it('is one append per scenario, each an inferred draft that reads, on free ids', () => {
		const { proposal, dropped } = generateProposal(request, [good, good], new Set(['bc-0001']), '2026-10-20', stamp);
		expect(dropped).toBe(0);
		expect(proposal!.edits.map((e) => (e as { path: string }).path)).toEqual(['Tactics/Scenarios/bc-0002.md', 'Tactics/Scenarios/bc-0003.md']);
		for (const e of proposal!.edits) {
			expect(e.kind).toBe('append');
			const read = parseScenario((e as { text: string }).text, (e as { path: string }).path);
			expect(read.ok && read.scenario).toMatchObject({ provenance: 'inferred', status: 'draft', whySuggested: true });
		}
	});

	it('drops a threat-call, a clear-order without a map, and a draft with no usable tag', () => {
		const { proposal, dropped } = generateProposal(
			{ ...request, game: 'ron' },
			[{ ...good, drill: 'threat-call' }, { ...good, drill: 'clear-order' }, { ...good, tags: ['roe.fire'] }],
			new Set(),
			'2026-10-20',
			stamp
		);
		expect(proposal).toBeNull();
		expect(dropped).toBe(3);
	});

	it('takes at most the count asked for', () => {
		const { proposal } = generateProposal({ ...request, count: 1 }, [good, good], new Set(), '2026-10-20', stamp);
		expect(proposal!.edits).toHaveLength(1);
	});
});

describe('readGenerateRequest', () => {
	it('needs a game and clamps the count', () => {
		expect(readGenerateRequest({})).toBeNull();
		expect(readGenerateRequest({ game: 'ron', count: 99 })!.count).toBeLessThanOrEqual(5);
	});
});

describe('suggestProposal', () => {
	it('is one revise that leaves the status and answer alone and appends options', async () => {
		await addStarters(vault);
		const scenario = (await loadLibrary(vault)).scenarios.find((s) => s.drill === 'hold-peek' || s.options.length)!;
		const note = await vault.read(scenario.path);
		const proposal = suggestProposal(
			scenario,
			note,
			{ situation: '', distractors: ['A brand new wrong option'], tags: ['cqb.extra'], why: '' } as never,
			{ ...stamp, feature: 'tactics-suggest' }
		)!;
		expect(proposal.edits).toHaveLength(1);
		const edit = proposal.edits[0] as { kind: string; text: string; expectedHash: string };
		expect(edit).toMatchObject({ kind: 'revise', expectedHash: note.hash });
		const read = parseScenario(edit.text, scenario.path);
		expect(read.ok && read.scenario.status).toBe('draft');
		expect(read.ok && read.scenario.answers).toEqual(scenario.answers);
		expect(read.ok && read.scenario.options.length).toBe(scenario.options.length + 1);
		expect(read.ok && read.scenario.tags).toContain('cqb.extra');
	});

	it('is null when nothing would change', async () => {
		await addStarters(vault);
		const scenario = (await loadLibrary(vault)).scenarios[0];
		const note = await vault.read(scenario.path);
		expect(suggestProposal(scenario, note, { situation: '', distractors: [], tags: [], why: '' } as never, stamp)).toBeNull();
	});
});

describe('the after-action review', () => {
	const body = { game: 'bodycam', map: 'Warehouse', happened: 'Peeked the same angle twice.', did: 'Peeked again', should: 'Swing wide from the other side', tags: ['bodycam.peek'] };

	it('writes the review, the template and a draft scenario that reads', async () => {
		const result = await recordAar(vault, body, '2026-10-20');
		expect(result).toMatchObject({ ok: true, id: 'bc-0001' });
		expect((await vault.read('Tactics/AAR Template.md')).exists).toBe(true);
		const { scenarios, problems } = await loadLibrary(vault);
		expect(problems).toEqual([]);
		expect(scenarios[0]).toMatchObject({ id: 'bc-0001', status: 'draft' });
		expect(scenarios[0].answers).toHaveLength(1);
	});

	it('numbers the next one and never overwrites', async () => {
		await recordAar(vault, body, '2026-10-20');
		const second = await recordAar(vault, body, '2026-10-20');
		expect(second).toMatchObject({ ok: true, id: 'bc-0002' });
		expect(second.ok && second.aarPath).toBe('Tactics/AAR/2026-10-20 Warehouse 2.md');
	});

	it('refuses a missing field, equal did and should, and a bad tag, writing nothing', async () => {
		for (const bad of [{ ...body, should: '' }, { ...body, should: 'peeked again' }, { ...body, tags: ['Bad Tag'] }, { ...body, tags: [] }]) {
			expect(await recordAar(vault, bad, '2026-10-20')).toMatchObject({ ok: false, reason: 'invalid' });
		}
		expect(await vault.files('Tactics', 'md', { deep: true })).toEqual([]);
	});
});

describe('policyFor', () => {
	const settings = { enabled: true, blast: DEFAULT_BLAST };
	it('lets tactics-generate write only scenario notes, up to five, and tactics-suggest one', () => {
		const dest = ['Tactics/Scenarios/bc-0001.md', 'Tactics/Scenarios/bc-0002.md', 'Notes/a.md', 'Tactics/Attempts/2026-10.md'];
		const g = policyFor('tactics-generate', settings, { today: '2026-10-20', destinations: dest });
		const s = policyFor('tactics-suggest', settings, { today: '2026-10-20', destinations: dest });
		expect(g.path.allow).toEqual(['Tactics/Scenarios/bc-0001.md', 'Tactics/Scenarios/bc-0002.md']);
		expect(g.blast.maxFiles).toBe(5);
		expect(s.path.allow).toEqual(['Tactics/Scenarios/bc-0001.md']);
		expect(s.blast.maxFiles).toBe(1);
	});
});
