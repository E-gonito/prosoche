import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { MAKE_CHARS, MAKE_NOTE_CHARS, cardsPrompt, draftCards, groundCards, type Suggestion } from './suggest-cards';
import type { Subject } from '../study/subjects';

const NOTE = [
	'# TCP',
	'',
	'The three-way handshake is SYN, SYN-ACK, ACK.',
	'A socket is identified by the four-tuple of source and destination address and port.',
	''
].join('\n');

const UDP = '# UDP\n\nUDP sends datagrams with no handshake at all.\n';

const SOURCES = [
	{ path: 'CS/TCP.md', text: NOTE },
	{ path: 'CS/UDP.md', text: UDP }
];

const CS: Subject = {
	slug: 'cs',
	name: 'Computer Science',
	color: '#000',
	home: 'Study/CS',
	scope: { folders: ['Study/CS', 'CS'], tags: [] },
	files: {
		goals: 'Study/CS/Goals.md',
		reading: 'Study/CS/Reading List.md',
		sessions: 'Study/CS/Sessions.md',
		flashcards: 'Study/CS/Flashcards'
	}
};

const card = (over: Partial<Suggestion>): Suggestion => ({
	question: 'What are the steps of the three-way handshake?',
	answer: 'SYN, SYN-ACK, ACK',
	source: 'CS/TCP.md',
	quote: 'The three-way handshake is SYN, SYN-ACK, ACK.',
	...over
});

describe('groundCards', () => {
	const cases: Array<{ what: string; card: Suggestion; kept: boolean }> = [
		{ what: 'a card whose answer its note states', card: card({}), kept: true },
		{ what: 'a card from the second note', card: card({ answer: 'no handshake', source: 'CS/UDP.md', quote: 'UDP sends datagrams with no handshake at all.' }), kept: true },
		{ what: 'a card with the path padded by spaces', card: card({ source: ' CS/TCP.md ' }), kept: true },
		{ what: 'punctuation and wrapping that differ', card: card({ answer: 'syn syn-ack ack', quote: 'the three-way handshake  is\nSYN, SYN-ACK,  ACK' }), kept: true },
		{ what: 'a quote the note does not have', card: card({ answer: 'four', quote: 'TCP uses a four-way handshake.' }), kept: false },
		{ what: 'an answer missing from its own quote', card: card({ answer: 'UDP' }), kept: false },
		{ what: 'a quote from another note than the one named', card: card({ source: 'CS/UDP.md' }), kept: false },
		{ what: 'a note that was not sent', card: card({ source: 'CS/Elsewhere.md' }), kept: false },
		{ what: 'an empty quote', card: card({ quote: '   ' }), kept: false },
		{ what: 'an answer with no words', card: card({ answer: '—' }), kept: false }
	];

	it.each(cases)('$what: kept $kept', ({ card: c, kept }) => {
		const { supported, dropped } = groundCards([c], SOURCES);
		expect(supported).toEqual(kept ? [c] : []);
		expect(dropped).toEqual(kept ? [] : [c]);
	});
});

describe('cardsPrompt', () => {
	it('names the subject and goal, lists what is already asked, and gives the notes as data', () => {
		const prompt = cardsPrompt({ subject: 'Computer Science', goal: 'Networking', count: 5, asked: ['What is  TCP?'], sources: SOURCES });
		expect(prompt).toContain('Write up to 5 flashcards');
		expect(prompt).toContain('"Computer Science" studies, towards their goal "Networking".');
		expect(prompt).toContain('- What is TCP?');
		expect(prompt).toContain('path="CS/TCP.md"');
		expect(prompt).toContain('The three-way handshake is SYN, SYN-ACK, ACK.');
	});

	it('says nothing of a goal or old cards when there are none', () => {
		const prompt = cardsPrompt({ subject: 'CS', goal: null, count: 10, asked: [], sources: SOURCES });
		expect(prompt).toContain('"CS" studies.');
		expect(prompt).not.toContain('already has cards');
	});
});

describe('draftCards', () => {
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
		await vault.write('Study/CS/Goals.md', '## Networking\n');
		await vault.write('CS/TCP.md', NOTE);
		await vault.write('CS/UDP.md', UDP);
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
		await rm(scratch, { recursive: true, force: true });
	});

	/** A stand-in CLI that prints one fixed answer, and keeps the prompt it was given. */
	async function fakeCli(result: unknown): Promise<string> {
		const path = join(scratch, 'fake-claude');
		const body = JSON.stringify({ type: 'result', subtype: 'success', result: JSON.stringify(result), total_cost_usd: 0.01 });
		// The prompt is the argument after `-p`.
		await writeFile(path, `#!/bin/sh\nprintf '%s' "$2" > '${join(scratch, 'prompt.txt')}'\ncat <<'JSON'\n${body}\nJSON\n`, 'utf8');
		await chmod(path, 0o755);
		return path;
	}

	const cli = (executable: string) => ({ cli: { executable, vaultPath: dir } });

	it('keeps the cards the notes support, drops the rest, and writes nothing', async () => {
		const executable = await fakeCli({
			cards: [
				card({}),
				card({ question: 'Does UDP shake hands?', answer: 'no handshake', source: 'CS/UDP.md', quote: 'UDP sends datagrams with no handshake at all.' }),
				card({ question: 'Port range?', answer: '0 to 65535', quote: 'Ports run from 0 to 65535.' })
			]
		});
		const before = (await vault.list()).length;
		const result = await draftCards(vault, CS, { folders: ['CS'], goal: 'networking' }, cli(executable));

		expect(result.problem).toBeNull();
		expect(result.destination).toBe('Study/CS/Flashcards/Networking.md');
		expect(result.cards).toEqual([
			{ question: 'What are the steps of the three-way handshake?', answer: 'SYN, SYN-ACK, ACK', quote: 'The three-way handshake is SYN, SYN-ACK, ACK.', source: 'CS/TCP.md', note: 'TCP' },
			{ question: 'Does UDP shake hands?', answer: 'no handshake', quote: 'UDP sends datagrams with no handshake at all.', source: 'CS/UDP.md', note: 'UDP' }
		]);
		expect(result.dropped).toEqual([{ question: 'Port range?', answer: '0 to 65535', source: 'CS/TCP.md', why: 'unsupported' }]);
		expect(result.batch).toEqual({ from: 0, read: 2, total: 2, chars: NOTE.length + UDP.length, next: null });
		// Only the audit log is new; no note, no card file.
		const after = await vault.list();
		expect(after.filter((p) => !p.startsWith('_hub/'))).toHaveLength(before - 1);
		expect(after.some((p) => p.startsWith('Study/CS/Flashcards/'))).toBe(false);
		expect((await vault.read('CS/TCP.md')).content).toBe(NOTE);
	});

	it('leaves out what the card file already asks, and says so', async () => {
		await vault.write('Study/CS/Flashcards/From notes.md', '#flashcards\n\nwhat are the steps of the three-way handshake::SYN\n');
		const executable = await fakeCli({ cards: [card({})] });
		const result = await draftCards(vault, CS, { notes: ['CS/TCP.md'] }, cli(executable));
		expect(result.cards).toEqual([]);
		expect(result.duplicates).toEqual(['What are the steps of the three-way handshake?']);
		expect(result.problem).toBeNull();
		// The model was told, too.
		expect(await readFile(join(scratch, 'prompt.txt'), 'utf8')).toContain('- what are the steps of the three-way handshake');
	});

	it('shows each side as it would be written', async () => {
		const executable = await fakeCli({ cards: [card({ question: 'What is #TCP handshake?' })] });
		const result = await draftCards(vault, CS, { notes: ['CS/TCP.md'] }, cli(executable));
		expect(result.cards[0].question).toBe('What is \\#TCP handshake?');
	});

	it('keeps at most the number asked for', async () => {
		const many = Array.from({ length: 8 }, (_, i) => card({ question: `Handshake question ${i}?` }));
		const executable = await fakeCli({ cards: many });
		const result = await draftCards(vault, CS, { notes: ['CS/TCP.md'], count: 5 }, cli(executable));
		expect(result.cards).toHaveLength(5);
	});

	it('reads a big folder in batches', async () => {
		for (let i = 0; i < 6; i++) await vault.write(`CS/Big/${i}.md`, `Note ${i}. ${'x'.repeat(MAKE_NOTE_CHARS)}`);
		const executable = await fakeCli({ cards: [] });
		const first = await draftCards(vault, CS, { folders: ['CS/Big'] }, cli(executable));
		const perRun = Math.floor(MAKE_CHARS / MAKE_NOTE_CHARS);
		expect(first.batch).toMatchObject({ from: 0, read: perRun, total: 6, next: perRun });
		expect(first.problem).toBe('No cards turned up in these notes.');
		const last = await draftCards(vault, CS, { folders: ['CS/Big'], from: first.batch!.next! }, cli(executable));
		expect(last.batch).toMatchObject({ from: perRun, read: 6 - perRun, next: null });
	});

	it.each([
		['nothing picked', {}, 'Pick a note or a folder to make cards from.'],
		['a note outside the subject', { notes: ['Journal/Day.md'] }, 'Pick a note or a folder to make cards from.'],
		['a goal that is not in Goals.md', { notes: ['CS/TCP.md'], goal: 'Cooking' }, 'There is no goal called "Cooking"']
	])('says why there is nothing for %s, without running Claude', async (_, input, problem) => {
		await vault.write('Journal/Day.md', 'A day.\n');
		const result = await draftCards(vault, CS, input, cli(join(scratch, 'not-there')));
		expect(result.cards).toEqual([]);
		expect(result.problem).toContain(problem);
	});

	it('refuses while the kill switch is off', async () => {
		await vault.write('_hub/ai.md', '---\nenabled: false\n---\n');
		const result = await draftCards(vault, CS, { notes: ['CS/TCP.md'] }, cli(join(scratch, 'not-there')));
		expect(result.cards).toEqual([]);
		expect(result.problem).toMatch(/off/i);
	});

	it('refuses output of the wrong shape rather than guessing at it', async () => {
		const executable = await fakeCli({ cards: [{ question: 'q' }] });
		const result = await draftCards(vault, CS, { notes: ['CS/TCP.md'] }, cli(executable));
		expect(result.cards).toEqual([]);
		expect(result.problem).not.toBeNull();
	});
});
