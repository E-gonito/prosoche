import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { NoteIndex } from '../index/index';
import { dueCards, formatComment, isCardSource, parseEntries, review, scanCards } from './flashcards';

describe('scanCards', () => {
	it('reads an inline card and the schedule on the line after it', () => {
		const note = ['#flashcards', '', 'What is a pointer::An address', '<!--SR:!2026-09-21,4,270-->', ''].join('\n');
		const [card] = scanCards(note, 'CS/Pointers.md');
		expect(card).toMatchObject({
			path: 'CS/Pointers.md',
			kind: 'inline',
			question: 'What is a pointer',
			answer: 'An address',
			line: 2,
			endLine: 2,
			scheduleLine: 3,
			scheduleExists: true,
			schedule: { due: '2026-09-21', interval: 4, ease: 270 }
		});
		expect(card.expectedRaw).toBe('<!--SR:!2026-09-21,4,270-->');
	});

	it('leaves a card with no comment pointing at its own last line', () => {
		const [card] = scanCards('#flashcards\n\nA::B\n', 'CS/x.md');
		expect(card.schedule).toBeNull();
		expect(card.scheduleExists).toBe(false);
		expect(card.scheduleLine).toBe(2);
		expect(card.expectedRaw).toBe('A::B');
	});

	it('tells a reversed inline card from an ordinary one', () => {
		const [card] = scanCards('#flashcards\n\nTerm:::Definition\n', 'CS/x.md');
		expect(card.kind).toBe('inline-reversed');
		expect(card.question).toBe('Term');
		expect(card.answer).toBe('Definition');
	});

	it('reads a multiline card across a `?` separator', () => {
		// The shape this vault actually uses, from Computer Science/LLMs.
		const note = ['#flashcards', '', '**Framing -**', '?', '`Begin with...`', 'Opens the section', ''].join('\n');
		const [card] = scanCards(note, 'CS/Prompting.md');
		expect(card).toMatchObject({ kind: 'multiline', question: '**Framing -**', line: 2, endLine: 5 });
		expect(card.answer).toBe('`Begin with...`\nOpens the section');
	});

	it('finds each card in a run of them', () => {
		const note = ['#flashcards', '', 'A::1', '<!--SR:!2026-01-01,3,250-->', 'B::2', 'C::3', ''].join('\n');
		const cards = scanCards(note, 'CS/x.md');
		expect(cards.map((c) => c.question)).toEqual(['A', 'B', 'C']);
		expect(cards[0].schedule?.due).toBe('2026-01-01');
		expect(cards[1].schedule).toBeNull();
		expect(cards[1].scheduleLine).toBe(4);
	});

	it('splits a cloze paragraph into one card per deletion, sharing a comment', () => {
		const note = ['#flashcards', '', 'The stack grows ==downwards== and the heap ==upwards==.', '<!--SR:!2026-09-21,4,270!2000-01-01,1,250-->', ''].join('\n');
		const cards = scanCards(note, 'CS/Memory.md');
		expect(cards).toHaveLength(2);
		expect(cards[0]).toMatchObject({ kind: 'cloze', answer: 'downwards', index: 0, siblings: 2 });
		expect(cards[0].question).toBe('The stack grows […] and the heap ==upwards==.');
		// The second deletion is stored with the plugin's magic date, so it is new.
		expect(cards[1].schedule).toBeNull();
		expect(cards[1].index).toBe(1);
	});
});

/**
 * Every case here is the shape of something a naive parser turns into a
 * flashcard: ordinary prose and code that happens to contain `::` or `==`.
 * They are the reason the scanner masks code before it matches.
 */
describe('things in this vault that are not cards', () => {
	const notCards: Array<[string, string]> = [
		['a Rust path in a fence', '#flashcards\n\n```rust\nlet s = String::from("x");\n```\n'],
		['a Rust path in a code span', '#flashcards\n\nUse `String::from` to build one.\n'],
		['a C comparison read as a cloze', '#flashcards\n\nCheck that (count == 0 && total == 0).\n'],
		['a bare question mark with nothing before it', '#flashcards\n\n?\nAn answer with no question\n'],
		['a separator with an empty side', '#flashcards\n\nA::\n'],
		['a heading that looks like a separator', '#flashcards\n\n## What is this?\n']
	];

	for (const [what, note] of notCards) {
		it(`ignores ${what}`, () => {
			expect(scanCards(note, 'CS/x.md')).toEqual([]);
		});
	}

	it('never looks inside frontmatter', () => {
		expect(scanCards('---\nalias::thing\n---\n\n#flashcards\n', 'CS/x.md')).toEqual([]);
	});
});

describe('isCardSource', () => {
	it('accepts a note the plugin would harvest', () => {
		expect(isCardSource(['flashcards'], 'A::B')).toBe(true);
		expect(isCardSource(['flashcards/cs'], 'A::B')).toBe(true);
	});

	it('accepts a note that already carries a schedule', () => {
		expect(isCardSource(['notes'], 'A::B\n<!--SR:!2026-01-01,1,250-->')).toBe(true);
	});

	it('rejects a note that merely contains something card-shaped', () => {
		expect(isCardSource(['reference'], 'A::B')).toBe(false);
	});
});

describe('the schedule comment', () => {
	it('round-trips the format the plugin writes', () => {
		const entries = parseEntries('<!--SR:!2023-09-02,4,270!2023-09-02,5,270-->');
		expect(entries).toEqual([
			{ due: '2023-09-02', interval: 4, ease: 270 },
			{ due: '2023-09-02', interval: 5, ease: 270 }
		]);
		expect(formatComment(entries, 0, 2, { due: '2026-10-01', interval: 9, ease: 290 })).toBe(
			'<!--SR:!2026-10-01,9,290!2023-09-02,5,270-->'
		);
	});

	it('reads the older form without the leading bang', () => {
		expect(parseEntries('<!--SR:2025-12-21,4,270-->')).toEqual([{ due: '2025-12-21', interval: 4, ease: 270 }]);
	});

	it('reads a fractional interval as whole days', () => {
		expect(parseEntries('<!--SR:!2025-12-21,2.5,250-->')).toEqual([{ due: '2025-12-21', interval: 3, ease: 250 }]);
	});

	it('keeps unreviewed siblings marked new', () => {
		expect(formatComment([], 1, 3, { due: '2026-10-01', interval: 9, ease: 290 })).toBe(
			'<!--SR:!2000-01-01,1,250!2026-10-01,9,290!2000-01-01,1,250-->'
		);
	});
});

describe('review', () => {
	let root: string;
	let vault: Vault;
	let index: NoteIndex;

	const NOTE = [
		'#flashcards',
		'',
		'What is a pointer::An address',
		'<!--SR:!2026-09-01,10,250-->',
		'',
		'What is a byte::Eight bits',
		''
	].join('\n');

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-cards-'));
		vault = new Vault(root);
		index = new NoteIndex(':memory:');
		await vault.write('CS/Basics.md', NOTE);
	});
	afterEach(async () => {
		index.close();
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('rewrites one line and leaves every other byte alone', async () => {
		const before = (await vault.read('CS/Basics.md')).content.split('\n');
		const [card] = scanCards(before.join('\n'), 'CS/Basics.md');
		const result = await review(vault, card, 'good', '2026-09-21');
		expect(result.ok).toBe(true);

		const after = (await vault.read('CS/Basics.md')).content.split('\n');
		// 20 days late, good: (10 + 10) * 2.5 = 50 days on from today.
		expect(after[3]).toBe('<!--SR:!2026-11-10,50,250-->');
		expect(after.filter((_, i) => i !== 3)).toEqual(before.filter((_, i) => i !== 3));
	});

	it('inserts one comment line for a card that has never been reviewed', async () => {
		const before = (await vault.read('CS/Basics.md')).content.split('\n');
		const card = scanCards(before.join('\n'), 'CS/Basics.md')[1];
		const result = await review(vault, card, 'easy', '2026-09-21');
		expect(result.ok && result.shift).toEqual({ path: 'CS/Basics.md', afterLine: 5, by: 1 });

		const after = (await vault.read('CS/Basics.md')).content.split('\n');
		expect(after[6]).toBe('<!--SR:!2026-09-25,4,270-->');
		expect(after.filter((_, i) => i !== 6)).toEqual(before);
	});

	it('hands back a card that can be graded again straight away', async () => {
		const first = scanCards((await vault.read('CS/Basics.md')).content, 'CS/Basics.md')[1];
		const once = await review(vault, first, 'good', '2026-09-21');
		expect(once.ok).toBe(true);
		if (!once.ok) return;
		const twice = await review(vault, once.card, 'good', '2026-09-21');
		expect(twice.ok).toBe(true);
		expect((await vault.read('CS/Basics.md')).content).toContain('<!--SR:!2026-09-29,8,250-->');
	});

	it('refuses when the line changed in Obsidian since the card was read', async () => {
		const [card] = scanCards((await vault.read('CS/Basics.md')).content, 'CS/Basics.md');
		await vault.write('CS/Basics.md', NOTE.replace('!2026-09-01,10,250', '!2027-01-01,99,250'));
		const result = await review(vault, card, 'good', '2026-09-21');
		expect(result).toMatchObject({ ok: false, reason: 'changed' });
	});

	it('reports a missing note rather than creating one', async () => {
		const [card] = scanCards(NOTE, 'CS/Gone.md');
		expect(await review(vault, card, 'good', '2026-09-21')).toMatchObject({ ok: false, reason: 'no-note' });
		expect((await vault.read('CS/Gone.md')).exists).toBe(false);
	});

	it('updates one deletion of a cloze and leaves its siblings alone', async () => {
		await vault.write('CS/Cloze.md', '#flashcards\n\nA ==one== and ==two==.\n<!--SR:!2026-09-01,10,250!2026-09-02,20,250-->\n');
		const cards = scanCards((await vault.read('CS/Cloze.md')).content, 'CS/Cloze.md');
		await review(vault, cards[1], 'hard', '2026-09-21');
		// Nineteen days late, hard: (20 + 19/4) * 0.5 = 12 days, ease down to 230.
		expect((await vault.read('CS/Cloze.md')).content).toContain('<!--SR:!2026-09-01,10,250!2026-10-03,12,230-->');
	});
});

describe('dueCards', () => {
	let root: string;
	let vault: Vault;
	let index: NoteIndex;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-due-'));
		vault = new Vault(root);
		index = new NoteIndex(':memory:');
		await vault.write('CS/Due.md', '#flashcards\n\nOverdue::yes\n<!--SR:!2026-09-01,4,250-->\n\nLater::no\n<!--SR:!2027-01-01,4,250-->\n\nNew::card\n');
		await vault.write('Art/Colour.md', '#flashcards\n\nHue::A colour\n');
		await vault.write('Notes/Prompting.md', '#prompt_engineering\n\nWhy prompt?\n?\nBecause.\n');
		for (const path of await vault.list()) {
			const note = await vault.read(path);
			index.put(path, note.content, note.mtimeMs, note.hash);
		}
	});
	afterEach(async () => {
		index.close();
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('returns overdue cards before new ones and leaves the future alone', async () => {
		const queue = await dueCards(vault, index, { on: '2026-09-21' });
		expect(queue.cards.map((c) => c.question)).toEqual(['Overdue', 'Hue', 'New']);
		expect(queue).toMatchObject({ due: 1, fresh: 2, total: 4 });
	});

	it('scopes to a folder, so the same widget shows different cards per workspace', async () => {
		const cs = await dueCards(vault, index, { on: '2026-09-21', scope: { folders: ['CS'] } });
		expect(cs.cards.map((c) => c.question)).toEqual(['Overdue', 'New']);
		const art = await dueCards(vault, index, { on: '2026-09-21', scope: { folders: ['Art'] } });
		expect(art.cards.map((c) => c.question)).toEqual(['Hue']);
	});

	it('scopes by a tag on the note as well as by folder', async () => {
		const queue = await dueCards(vault, index, { on: '2026-09-21', scope: { tags: ['prompt_engineering'] } });
		expect(queue.total).toBe(0);
		expect(queue.invisible).toEqual([{ path: 'Notes/Prompting.md', title: 'Prompting', cards: 1 }]);
	});

	it('counts cards Obsidian cannot see rather than reviewing them behind its back', async () => {
		const queue = await dueCards(vault, index, { on: '2026-09-21' });
		expect(queue.cards.some((c) => c.path === 'Notes/Prompting.md')).toBe(false);
		expect(queue.invisible).toEqual([{ path: 'Notes/Prompting.md', title: 'Prompting', cards: 1 }]);
	});

	it('does not call a highlight in an untagged note a missing flashcard', async () => {
		await vault.write('Notes/Speech.md', 'He said it was ==very good== indeed.\n');
		const note = await vault.read('Notes/Speech.md');
		index.put('Notes/Speech.md', note.content, note.mtimeMs, note.hash);
		const queue = await dueCards(vault, index, { on: '2026-09-21' });
		expect(queue.invisible.map((i) => i.path)).toEqual(['Notes/Prompting.md']);
	});

	it('honours the limit without lying about the totals', async () => {
		const queue = await dueCards(vault, index, { on: '2026-09-21', limit: 1 });
		expect(queue.cards).toHaveLength(1);
		expect(queue.total).toBe(4);
	});
});
