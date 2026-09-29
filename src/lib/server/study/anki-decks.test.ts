import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { importAnkiDecks } from './anki-decks';
import { scanCards } from './flashcards';

const HTTP = [
	'#separator:Tab',
	'#html:true',
	'#deck:CS::Networking',
	'#tags:CS Networking',
	'',
	'What is HTTP?\tHyper Text Transfer Protocol&lt;br&gt;<pre>GET /<br>200 OK</pre>',
	'What is TCP?\tA reliable, ordered stream',
	''
].join('\n');
const WISDOM = ['#separator:Tab', '#html:true', '#deck:Wisdom', '', 'What is Grounding?\tanchoring ideas in experience', ''].join('\n');
const EMPTY = ['#separator:Tab', '#html:true', '#deck:Empty', '', ''].join('\n');

let root: string;
let vault: Vault;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-anki-'));
	vault = new Vault(root);
	await mkdir(join(root, 'Flashcards/CS/Networking'), { recursive: true });
	await writeFile(join(root, 'Flashcards/CS/Networking/HTTP.txt'), HTTP);
	await writeFile(join(root, 'Flashcards/Wisdom.txt'), WISDOM);
	await writeFile(join(root, 'Flashcards/Empty.txt'), EMPTY);
});
afterEach(async () => {
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

describe('importAnkiDecks', () => {
	it('plans every deck without writing anything', async () => {
		const decks = await importAnkiDecks(vault, 'Study');
		expect(decks.map((d) => [d.source, d.target, d.deck, d.cards, d.status])).toEqual([
			['Flashcards/CS/Networking/HTTP.txt', 'Study/Flashcards/CS/Networking/HTTP.md', 'CS::Networking', 2, 'new'],
			['Flashcards/Empty.txt', 'Study/Flashcards/Empty.md', 'Empty', 0, 'empty'],
			['Flashcards/Wisdom.txt', 'Study/Flashcards/Wisdom.md', 'Wisdom', 1, 'new']
		]);
		expect(decks[0].sample).toEqual({ front: 'What is HTTP?', back: 'Hyper Text Transfer Protocol\n```\nGET /\n200 OK\n```' });
		expect(decks[1].sample).toBeNull();
		expect(await vault.list()).toEqual([]);
	});

	it('writes each new deck as a card file the card finder reads', async () => {
		const decks = await importAnkiDecks(vault, 'Study', { apply: true });
		expect(decks.map((d) => d.status)).toEqual(['created', 'empty', 'created']);
		expect(await vault.list()).toEqual(['Study/Flashcards/CS/Networking/HTTP.md', 'Study/Flashcards/Wisdom.md']);

		const note = (await vault.read('Study/Flashcards/CS/Networking/HTTP.md')).content;
		expect(note.startsWith('---\ngoal:\nsource: Flashcards/CS/Networking/HTTP.txt\n---\n\n#flashcards/cs/networking\n')).toBe(true);
		const cards = scanCards(note, 'Study/Flashcards/CS/Networking/HTTP.md');
		expect(cards.map((c) => c.question)).toEqual(['What is HTTP?', 'What is TCP?']);
		expect(cards.every((c) => c.schedule === null)).toBe(true);
	});

	it('never overwrites a card file that is already there, and says so', async () => {
		await mkdir(join(root, 'Study/Flashcards'), { recursive: true });
		await writeFile(join(root, 'Study/Flashcards/Wisdom.md'), 'mine\n');

		const planned = await importAnkiDecks(vault, 'Study');
		expect(planned.find((d) => d.source === 'Flashcards/Wisdom.txt')?.status).toBe('exists');

		const applied = await importAnkiDecks(vault, 'Study', { apply: true });
		expect(applied.map((d) => d.status)).toEqual(['created', 'empty', 'exists']);
		expect(await readFile(join(root, 'Study/Flashcards/Wisdom.md'), 'utf8')).toBe('mine\n');
	});

	it('is harmless to run twice', async () => {
		await importAnkiDecks(vault, 'Study', { apply: true });
		const first = (await vault.read('Study/Flashcards/Wisdom.md')).content;
		const again = await importAnkiDecks(vault, 'Study', { apply: true });
		expect(again.map((d) => d.status)).toEqual(['exists', 'empty', 'exists']);
		expect((await vault.read('Study/Flashcards/Wisdom.md')).content).toBe(first);
	});

	it('never touches a .txt deck', async () => {
		const before = await stat(join(root, 'Flashcards/Wisdom.txt'));
		await importAnkiDecks(vault, 'Study', { apply: true });
		expect(await readFile(join(root, 'Flashcards/Wisdom.txt'), 'utf8')).toBe(WISDOM);
		expect((await stat(join(root, 'Flashcards/Wisdom.txt'))).mtimeMs).toBe(before.mtimeMs);
		expect(await vault.files('Flashcards', 'txt', { deep: true })).toEqual(['CS/Networking/HTTP.txt', 'Empty.txt', 'Wisdom.txt']);
	});

	it('files cards beside the decks when study has no home folder', async () => {
		const decks = await importAnkiDecks(vault, '');
		expect(decks[2].target).toBe('Flashcards/Wisdom.md');
	});

	it('reads as nothing to import when there is no Flashcards folder', async () => {
		await rm(join(root, 'Flashcards'), { recursive: true });
		expect(await importAnkiDecks(vault, 'Study', { apply: true })).toEqual([]);
	});
});
