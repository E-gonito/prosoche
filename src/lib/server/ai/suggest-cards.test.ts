import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { partition, propose, suggestCards, type Suggestion } from './suggest-cards';
import { scanCards } from '../study/flashcards';
import type { RunStamp } from '$lib/shared/ai';

const STAMP: RunStamp = {
	model: 'claude-sonnet-5',
	effort: 'medium',
	permission: 'propose',
	budgetUsd: 0.25,
	timeoutSeconds: 120,
	feature: 'suggest-flashcards',
	startedAt: '2026-09-21T10:00:00.000Z',
	durationMs: 1200,
	costUsd: 0.03
};

const NOTE = [
	'# TCP',
	'',
	'The three-way handshake is SYN, SYN-ACK, ACK.',
	'A socket is identified by the four-tuple of source and destination address and port.',
	''
].join('\n');

describe('partition', () => {
	const card = (over: Partial<Suggestion>): Suggestion => ({
		question: 'q',
		answer: 'a',
		quote: 'q',
		...over
	});

	it('keeps a card whose answer the note states', () => {
		const good = card({
			question: 'What are the steps of the three-way handshake?',
			answer: 'SYN, SYN-ACK, ACK',
			quote: 'The three-way handshake is SYN, SYN-ACK, ACK.'
		});
		expect(partition([good], NOTE).supported).toEqual([good]);
	});

	it('drops a card whose quote is not in the note', () => {
		const invented = card({
			answer: 'four',
			quote: 'TCP uses a four-way handshake.'
		});
		const { supported, unsupported } = partition([invented], NOTE);
		expect(supported).toEqual([]);
		expect(unsupported).toEqual([invented]);
	});

	it('drops a card whose answer is not in its own quote', () => {
		const mismatched = card({
			answer: 'UDP',
			quote: 'The three-way handshake is SYN, SYN-ACK, ACK.'
		});
		expect(partition([mismatched], NOTE).supported).toEqual([]);
	});

	it('ignores punctuation and line wrapping when comparing', () => {
		const wrapped = card({
			answer: 'syn syn-ack ack',
			quote: 'the three-way handshake  is\nSYN, SYN-ACK,  ACK'
		});
		expect(partition([wrapped], NOTE).supported).toEqual([wrapped]);
	});

	it('drops a card with an empty quote rather than trusting it', () => {
		expect(partition([card({ quote: '   ' })], NOTE).supported).toEqual([]);
	});
});

describe('propose', () => {
	const cards: Suggestion[] = [
		{ question: 'Handshake?', answer: 'SYN, SYN-ACK, ACK', quote: 'x' },
		{ question: 'Socket?', answer: 'The four-tuple', quote: 'y' }
	];

	it('is one append to the note it read and nothing else', () => {
		const proposal = propose('CS/TCP.md', cards, STAMP);
		expect(proposal.edits).toHaveLength(1);
		expect(proposal.edits[0]).toMatchObject({ kind: 'append', path: 'CS/TCP.md' });
		expect(proposal.accepted).toEqual([]);
	});

	it('writes cards the flashcard parser reads back', () => {
		const proposal = propose('CS/TCP.md', cards, STAMP);
		const edit = proposal.edits[0];
		const after = `${NOTE}${'text' in edit ? edit.text : ''}`;
		const found = scanCards(after, 'CS/TCP.md');
		expect(found.map((c) => c.question)).toEqual(['Handshake?', 'Socket?']);
		expect(found.map((c) => c.answer)).toEqual(['SYN, SYN-ACK, ACK', 'The four-tuple']);
	});

	it('flattens a question written over several lines', () => {
		const proposal = propose('CS/TCP.md', [{ question: 'a\nb', answer: 'c\nd', quote: 'x' }], STAMP);
		const edit = proposal.edits[0];
		expect('text' in edit ? edit.text : '').toBe('\na b::c d\n');
	});
});

describe('suggestCards', () => {
	let dir: string;
	let vault: Vault;
	let scratch: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'cards-vault-'));
		scratch = await mkdtemp(join(tmpdir(), 'cards-cli-'));
		vault = new Vault(dir);
		// The layer is off in a vault with no `_hub/ai.md`; these tests are
		// about what happens once it is on.
		await vault.write('_hub/ai.md', '---\nenabled: true\n---\n');
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
		await rm(scratch, { recursive: true, force: true });
	});

	/** A stand-in CLI that prints one fixed response. */
	async function fakeCli(body: string): Promise<string> {
		const path = join(scratch, 'fake-claude');
		await writeFile(path, `#!/bin/sh\ncat <<'JSON'\n${body}\nJSON\n`, 'utf8');
		await chmod(path, 0o755);
		return path;
	}

	const envelope = (result: unknown) =>
		JSON.stringify({ type: 'result', subtype: 'success', result: JSON.stringify(result), total_cost_usd: 0.01 });

	it('proposes nothing for a note that is not there', async () => {
		const result = await suggestCards(vault, 'CS/Missing.md');
		expect(result.proposal).toBeNull();
		expect(result.problem).toBeNull();
	});

	it('proposes nothing while the kill switch is off', async () => {
		await vault.write('_hub/ai.md', '---\nenabled: false\n---\n');
		await vault.write('CS/TCP.md', NOTE);
		const result = await suggestCards(vault, 'CS/TCP.md');
		expect(result.proposal).toBeNull();
		expect(result.refusals[0].guardrail).toBe('G10');
	});

	it('drops the suggestions the note does not support', async () => {
		await vault.write('CS/TCP.md', NOTE);
		const executable = await fakeCli(
			envelope({
				cards: [
					{
						question: 'Handshake?',
						answer: 'SYN, SYN-ACK, ACK',
						quote: 'The three-way handshake is SYN, SYN-ACK, ACK.'
					},
					{ question: 'Port range?', answer: '0 to 65535', quote: 'Ports run from 0 to 65535.' }
				]
			})
		);

		const result = await suggestCards(vault, 'CS/TCP.md', { cli: { executable, vaultPath: dir } });
		expect(result.unsupported.map((c) => c.question)).toEqual(['Port range?']);
		expect(result.proposal?.edits).toHaveLength(1);
		const edit = result.proposal!.edits[0];
		expect('text' in edit ? edit.text : '').toContain('Handshake?::SYN, SYN-ACK, ACK');
		expect('text' in edit ? edit.text : '').not.toContain('65535');
	});

	it('proposes nothing when every suggestion was invented', async () => {
		await vault.write('CS/TCP.md', NOTE);
		const executable = await fakeCli(
			envelope({ cards: [{ question: 'Port range?', answer: '0 to 65535', quote: 'Ports run from 0 to 65535.' }] })
		);
		const result = await suggestCards(vault, 'CS/TCP.md', { cli: { executable, vaultPath: dir } });
		expect(result.proposal).toBeNull();
		expect(result.unsupported).toHaveLength(1);
		expect(result.problem).toBeNull();
	});

	it('refuses output of the wrong shape rather than guessing at it', async () => {
		await vault.write('CS/TCP.md', NOTE);
		const executable = await fakeCli(envelope({ cards: [{ question: 'q' }] }));
		const result = await suggestCards(vault, 'CS/TCP.md', { cli: { executable, vaultPath: dir } });
		expect(result.proposal).toBeNull();
		expect(result.refusals[0].guardrail).toBe('G6');
	});

	it('never writes the note, whatever came back', async () => {
		await vault.write('CS/TCP.md', NOTE);
		const executable = await fakeCli(
			envelope({
				cards: [
					{
						question: 'Handshake?',
						answer: 'SYN, SYN-ACK, ACK',
						quote: 'The three-way handshake is SYN, SYN-ACK, ACK.'
					}
				]
			})
		);
		await suggestCards(vault, 'CS/TCP.md', { cli: { executable, vaultPath: dir } });
		expect((await vault.read('CS/TCP.md')).content).toBe(NOTE);
	});
});
