import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { parseNote } from '../parse/note';
import { cardBlock } from './anki-import';
import { addCards, cardFilePath, pickedNotes, questionKey, sourceNotes, withNewCards, type FiledCard } from './card-files';
import { fileGoal, isCardSource, scanCards } from './flashcards';
import type { Subject } from './subjects';

const CS: Subject = {
	slug: 'cs',
	name: 'Computer Science',
	color: '#000',
	home: 'Study/CS',
	scope: { folders: ['Study/CS', 'Computer Science'], tags: ['ws/cs'] },
	newPerDay: 20,
	files: {
		goals: 'Study/CS/Goals.md',
		reading: 'Study/CS/Reading List.md',
		sessions: 'Study/CS/Sessions.md',
		flashcards: 'Study/CS/Flashcards'
	}
};

/** A card as `addCards` files it, from a typed question and answer. */
function filed(front: string, back: string, note = 'TCP'): FiledCard {
	const block = cardBlock(front, back)!;
	return { front: block.card.front, back: block.card.back, markdown: block.markdown, note };
}

/** Whether every line of `before` is still in `after`, in order: nothing changed or moved, only inserted. */
function onlyInserted(before: string, after: string): boolean {
	const lines = after.split('\n');
	let at = 0;
	for (const line of before.replace(/\n$/, '').split('\n')) {
		while (at < lines.length && lines[at] !== line) at++;
		if (at === lines.length) return false;
		at++;
	}
	return true;
}

describe('cardFilePath', () => {
	it.each([
		[null, 'Study/CS/Flashcards/From notes.md'],
		['Networking', 'Study/CS/Flashcards/Networking.md'],
		['Pass AWS: Solutions Architect', 'Study/CS/Flashcards/Pass AWS Solutions Architect.md'],
		['C/C++ [systems] #1', 'Study/CS/Flashcards/C C++ systems 1.md'],
		['../../etc', 'Study/CS/Flashcards/etc.md'],
		['///', 'Study/CS/Flashcards/From notes.md']
	])('files cards under %s in %s', (goal, path) => {
		expect(cardFilePath(CS, goal)).toBe(path);
	});
});

describe('questionKey', () => {
	it('reads two spellings of one question as the same', () => {
		expect(questionKey('What is  TCP?')).toBe(questionKey('what is tcp'));
		expect(questionKey('What is TCP?')).not.toBe(questionKey('What is UDP?'));
	});
});

describe('pickedNotes', () => {
	const offered = ['Computer Science/Net/TCP.md', 'Computer Science/Net/UDP.md', 'Computer Science/OS/Paging.md', 'Study/CS/Intro.md'].map((path) => ({
		path,
		title: path,
		mtimeMs: 0
	}));

	it.each([
		['a note', { notes: ['Study/CS/Intro.md'] }, ['Study/CS/Intro.md']],
		['a folder, by path', { folders: ['Computer Science/Net'] }, ['Computer Science/Net/TCP.md', 'Computer Science/Net/UDP.md']],
		['notes first, in the order given, then folders, each once', { notes: ['Computer Science/Net/UDP.md', 'Study/CS/Intro.md'], folders: ['Computer Science/Net/'] }, ['Computer Science/Net/UDP.md', 'Study/CS/Intro.md', 'Computer Science/Net/TCP.md']],
		['nothing it does not offer', { notes: ['Private/Diary.md', '../x.md'], folders: ['Journal', 'Computer'] }, []],
		['no empty folder, which would mean everything', { folders: ['', '/'] }, []]
	])('picks %s', (_, pick, expected) => {
		expect(pickedNotes(offered, pick)).toEqual(expected);
	});
});

describe('withNewCards', () => {
	const PATH = 'Study/CS/Flashcards/Networking.md';

	it('starts a card file with goal:, the tag and a heading per note', () => {
		const out = withNewCards('', PATH, 'Networking', [filed('What opens a TCP connection?', 'The three-way handshake'), filed('Ports?', 'a\nb', 'UDP')]);
		expect(out?.content).toBe(
			[
				'---',
				'goal: Networking',
				'---',
				'',
				'#flashcards',
				'',
				'## [[TCP]]',
				'',
				'What opens a TCP connection?::The three-way handshake',
				'',
				'## [[UDP]]',
				'',
				'Ports?',
				'?',
				'a',
				'b',
				''
			].join('\n')
		);
		const parsed = parseNote(out!.content, PATH);
		expect(fileGoal(parsed.frontmatter)).toBe('Networking');
		expect(isCardSource(parsed.tags, out!.content)).toBe(true);
		expect(scanCards(out!.content, PATH).map((c) => c.question)).toEqual(['What opens a TCP connection?', 'Ports?']);
	});

	it('leaves goal: empty for cards under no goal', () => {
		const out = withNewCards('', 'Study/CS/Flashcards/From notes.md', null, [filed('Q', 'A')]);
		expect(out?.content.startsWith('---\ngoal:\n---\n\n#flashcards\n\n## [[TCP]]\n\nQ::A\n')).toBe(true);
		expect(fileGoal(parseNote(out!.content).frontmatter)).toBeNull();
	});

	it('quotes a goal YAML would misread', () => {
		const out = withNewCards('', PATH, 'Pass AWS: Solutions Architect', [filed('Q', 'A')]);
		expect(fileGoal(parseNote(out!.content).frontmatter)).toBe('Pass AWS: Solutions Architect');
	});

	const EXISTING = [
		'---',
		'goal: Networking',
		'---',
		'',
		'#flashcards',
		'',
		'## [[TCP]]',
		'',
		'Old one::reviewed',
		'<!--SR:!2026-10-01,4,270-->',
		'',
		'How to comment in sh?',
		'?',
		'```sh',
		'# like this',
		'```',
		'',
		'## [[UDP]]',
		'',
		'Is UDP reliable?::No',
		''
	].join('\n');

	const cases: Array<{ what: string; content: string; cards: FiledCard[]; expected: string }> = [
		{
			what: 'goes at the end of its note’s section, past a fenced # line',
			content: EXISTING,
			cards: [filed('New one', 'yes')],
			expected: EXISTING.replace('# like this\n```\n\n', '# like this\n```\n\nNew one::yes\n\n')
		},
		{
			what: 'goes under a new heading at the end for a new note',
			content: EXISTING,
			cards: [filed('Paging?', 'Fixed-size blocks', 'Paging')],
			expected: `${EXISTING}\n## [[Paging]]\n\nPaging?::Fixed-size blocks\n`
		},
		{
			what: 'adds a blank line to a file that ends without a newline',
			content: '#flashcards\n\nQ::A',
			cards: [filed('R', 'B')],
			expected: '#flashcards\n\nQ::A\n\n## [[TCP]]\n\nR::B\n'
		},
		{
			what: 'keeps trailing blank lines where they are',
			content: '#flashcards\n\n## [[TCP]]\nQ::A\n\n\n',
			cards: [filed('R', 'B')],
			expected: '#flashcards\n\n## [[TCP]]\nQ::A\n\nR::B\n\n\n'
		},
		{
			what: 'tags a file Obsidian would not yet review',
			content: 'Some notes of mine\n',
			cards: [filed('R', 'B')],
			expected: 'Some notes of mine\n\n## [[TCP]]\n\nR::B\n\n#flashcards\n'
		},
		{
			what: 'keeps each multiline card its own paragraph',
			content: '#flashcards\n\n## [[TCP]]\n\nOld::one\n',
			cards: [filed('Two lines?', 'one\ntwo'), filed('After', 'it')],
			expected: '#flashcards\n\n## [[TCP]]\n\nOld::one\n\nTwo lines?\n?\none\ntwo\n\nAfter::it\n'
		},
		{
			what: 'files a note whose name cannot be linked under its bare name',
			content: '#flashcards\n',
			cards: [filed('Q', 'A', 'C# [basics]')],
			expected: '#flashcards\n\n## C# [basics]\n\nQ::A\n'
		}
	];

	it.each(cases)('$what', ({ content, cards, expected }) => {
		const out = withNewCards(content, PATH, 'Networking', cards);
		expect(out?.content).toBe(expected);
		expect(onlyInserted(content, out!.content)).toBe(true);
		expect(scanCards(out!.content, PATH)).toHaveLength(scanCards(content, PATH).length + cards.length);
	});

	it('skips a question the file already asks, and one asked twice in the batch', () => {
		const out = withNewCards(EXISTING, PATH, 'Networking', [filed('old one?', 'again'), filed('New', 'a'), filed('new', 'b')]);
		expect(out?.added.map((c) => c.front)).toEqual(['New']);
		expect(out?.skipped).toBe(2);
	});

	it('changes nothing when every card is already there', () => {
		const out = withNewCards(EXISTING, PATH, 'Networking', [filed('Is UDP reliable?', 'No', 'UDP')]);
		expect(out).toEqual({ content: EXISTING, added: [], skipped: 1 });
	});

	it('refuses a card that would not read back as itself', () => {
		const forged: FiledCard = { front: 'Q', back: 'A', markdown: 'Q::A\n?\nswallowed', note: 'TCP' };
		expect(withNewCards('#flashcards\n', PATH, null, [forged])).toBeNull();
	});
});

describe('addCards', () => {
	let dir: string;
	let vault: Vault;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'card-files-'));
		vault = new Vault(dir);
		await vault.write('Study/CS/Goals.md', '## Networking\n- [ ] Read RFC 793\n\n## Pass AWS: Solutions Architect\n');
		await vault.write('Computer Science/Net/TCP.md', '# TCP\n\nThe three-way handshake is SYN, SYN-ACK, ACK.\n');
		await vault.write('Journal/2026-09-29.md', 'A day.\n');
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const card = { question: 'What opens a TCP connection?', answer: 'The three-way handshake', source: 'Computer Science/Net/TCP.md' };

	it('writes the cards to the goal’s file and nothing else', async () => {
		const tcp = (await vault.read('Computer Science/Net/TCP.md')).content;
		const result = await addCards(vault, CS, { goal: 'networking', cards: [card] });
		expect(result).toMatchObject({ ok: true, path: 'Study/CS/Flashcards/Networking.md', added: 1, skipped: 0, goal: { name: 'Networking', slug: 'networking' } });
		const file = (await vault.read('Study/CS/Flashcards/Networking.md')).content;
		expect(file).toContain('goal: Networking\n');
		expect(file).toContain('## [[TCP]]\n\nWhat opens a TCP connection?::The three-way handshake\n');
		expect((await vault.read('Computer Science/Net/TCP.md')).content).toBe(tcp);
		expect((await vault.list()).sort()).toEqual(['Computer Science/Net/TCP.md', 'Journal/2026-09-29.md', 'Study/CS/Flashcards/Networking.md', 'Study/CS/Goals.md']);
	});

	it('writes cards under no goal to From notes.md, and appends to it next time', async () => {
		await addCards(vault, CS, { goal: null, cards: [card] });
		const second = await addCards(vault, CS, { goal: '', cards: [card, { ...card, question: 'What does SYN do?', answer: 'Opens it' }] });
		expect(second).toMatchObject({ ok: true, path: 'Study/CS/Flashcards/From notes.md', added: 1, skipped: 1, goal: null });
		const file = (await vault.read('Study/CS/Flashcards/From notes.md')).content;
		expect(scanCards(file, 'x.md').map((c) => c.question)).toEqual(['What opens a TCP connection?', 'What does SYN do?']);
		expect(file.match(/## \[\[TCP\]\]/g)).toHaveLength(1);
	});

	it('writes nothing when every card is already there', async () => {
		await addCards(vault, CS, { goal: null, cards: [card] });
		const before = await vault.read('Study/CS/Flashcards/From notes.md');
		const again = await addCards(vault, CS, { goal: null, cards: [card] });
		expect(again).toMatchObject({ ok: true, added: 0, skipped: 1 });
		expect((await vault.read('Study/CS/Flashcards/From notes.md')).mtimeMs).toBe(before.mtimeMs);
	});

	it.each([
		['a goal that is not in Goals.md', { goal: 'Cooking', cards: [card] }, 'There is no goal called "Cooking"'],
		['no cards', { goal: null, cards: [] }, 'There are no cards to add.'],
		['cards that are not a list', { goal: null, cards: 'Q::A' }, 'There are no cards to add.'],
		['too many cards', { goal: null, cards: Array.from({ length: 61 }, () => card) }, 'At most 60 cards'],
		['a card that is not a card', { goal: null, cards: [card, { question: 'Q' }] }, 'Card 2 is not a card.'],
		['an empty answer', { goal: null, cards: [{ ...card, answer: '\n  \n' }] }, 'Card 1 needs both a question and an answer.'],
		['a note outside the subject', { goal: null, cards: [{ ...card, source: 'Journal/2026-09-29.md' }] }, 'Card 1 names a note that is not one of'],
		['a note that is not there', { goal: null, cards: [{ ...card, source: 'Computer Science/Net/Gone.md' }] }, 'Card 1 names a note'],
		['one of the subject’s own card files as a source', { goal: null, cards: [{ ...card, source: 'Study/CS/Goals.md' }] }, 'Card 1 names a note'],
		['a side past the limit', { goal: null, cards: [{ ...card, answer: 'x'.repeat(4001) }] }, 'Card 1 is too long.']
	])('refuses %s and writes nothing', async (_, input, message) => {
		const result = await addCards(vault, CS, input);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.problems.join(' ')).toContain(message);
		expect(await vault.list()).not.toContain('Study/CS/Flashcards/From notes.md');
		expect((await vault.list()).some((p) => p.startsWith('Study/CS/Flashcards/'))).toBe(false);
	});

	it('escapes what a person typed, as the Anki import does', async () => {
		const result = await addCards(vault, CS, { goal: null, cards: [{ ...card, question: 'What is #TCP?', answer: 'one\n\n## two\n?' }] });
		expect(result.ok).toBe(true);
		const file = (await vault.read('Study/CS/Flashcards/From notes.md')).content;
		expect(file).toContain('What is \\#TCP?\n?\none\n**two**\n\\?\n');
		expect(parseNote(file).tags).toEqual(['flashcards']);
	});

	it('is a conflict, not an overwrite, when the file changed meanwhile', async () => {
		await addCards(vault, CS, { goal: null, cards: [card] });
		const realWrite = vault.write.bind(vault);
		// The card file changes between being read and being written.
		vault.write = async (path, content, expectedHash, opts) => {
			const now = await vault.read(path);
			await realWrite(path, `${now.content}\nMine::typed in Obsidian\n`);
			return realWrite(path, content, expectedHash, opts);
		};
		const result = await addCards(vault, CS, { goal: null, cards: [{ ...card, question: 'New?', answer: 'Yes' }] });
		expect(result).toMatchObject({ ok: false, reason: 'conflict' });
		vault.write = realWrite;
		expect((await vault.read('Study/CS/Flashcards/From notes.md')).content).toContain('Mine::typed in Obsidian');
		expect((await vault.read('Study/CS/Flashcards/From notes.md')).content).not.toContain('New?');
	});
});

describe('sourceNotes', () => {
	let dir: string;
	let vault: Vault;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'card-sources-'));
		vault = new Vault(dir);
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('offers the subject’s notes and folders, never its own files', async () => {
		for (const path of [
			'Computer Science/Net/TCP.md',
			'Computer Science/OS/Paging.md',
			'Study/CS/Intro.md',
			'Study/CS/Goals.md',
			'Study/CS/Sessions.md',
			'Study/CS/Reading List.md',
			'Study/CS/Flashcards/From notes.md',
			'Journal/Day.md'
		]) {
			await vault.write(path, `# ${path}\n`);
		}
		await vault.write('Journal/Tagged.md', '# Tagged\n#ws/cs\n');

		const { notes, folders } = await sourceNotes(vault, CS);
		expect(notes.map((n) => n.path)).toEqual(['Computer Science/Net/TCP.md', 'Computer Science/OS/Paging.md', 'Journal/Tagged.md', 'Study/CS/Intro.md']);
		expect(notes[0].title).toBe('Computer Science/Net/TCP.md');
		expect(folders).toEqual(['Computer Science', 'Computer Science/Net', 'Computer Science/OS', 'Study/CS']);
	});
});
