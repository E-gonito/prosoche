import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { NoteIndex } from '../index/index';
import { dueCards, fileGoal, formatComment, isCardSource, parseEntries, review, scanCards, setCardFileGoal } from './flashcards';
import { fromSm2, outcomes, type Schedule } from '$lib/shared/scheduler';

/** A review-state schedule for the comment tests. */
const REVIEWED: Schedule = { due: '2026-10-02', stability: 3.21, difficulty: 5.8, reps: 4, lapses: 0, state: 'review', last: '2026-09-29' };

describe('scanCards', () => {
	it('reads an inline card and the schedule on the line after it', () => {
		const comment = '<!--fsrs:2026-10-02,3.21,5.8,4,0,review,2026-09-29-->';
		const note = ['#flashcards', '', 'What is a pointer::An address', comment, ''].join('\n');
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
			schedule: REVIEWED
		});
		expect(card.expectedRaw).toBe(comment);
	});

	it('reads the plugin’s legacy comment as FSRS state seeded from SM-2', () => {
		const note = ['#flashcards', '', 'What is a pointer::An address', '<!--SR:!2026-09-21,4,270-->', ''].join('\n');
		const [card] = scanCards(note, 'CS/Pointers.md');
		expect(card).toMatchObject({ scheduleLine: 3, scheduleExists: true, schedule: fromSm2('2026-09-21', 4, 270) });
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

	it('keeps a fenced block inside a multiline card, blank lines and all', () => {
		// As the plugin does: a fence belongs to the paragraph it sits in.
		const note = ['#flashcards', '', 'Print a path', '?', '```rust', 'use std::io;', '', '?', '```', 'Then run it.', ''].join('\n');
		const [card, ...rest] = scanCards(note, 'CS/x.md');
		expect(rest).toEqual([]);
		expect(card).toMatchObject({ kind: 'multiline', question: 'Print a path', line: 2, endLine: 9 });
		expect(card.answer).toBe('```rust\nuse std::io;\n\n?\n```\nThen run it.');
	});

	it('never takes a separator from inside a fence', () => {
		const note = ['#flashcards', '', 'Prose', '```', 'a::b', '?', '==x==', '```', ''].join('\n');
		expect(scanCards(note, 'CS/x.md')).toEqual([]);
	});

	it('finds a cloze beside a fence but never inside it', () => {
		const note = ['#flashcards', '', 'The ==stack== grows down', '```', 'if (a ==b==c) {}', '```', ''].join('\n');
		const cards = scanCards(note, 'CS/x.md');
		expect(cards.map((c) => c.answer)).toEqual(['stack']);
		expect(cards[0].question).toBe('The […] grows down\n```\nif (a ==b==c) {}\n```');
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
		expect(isCardSource(['notes'], 'A::B\n<!--fsrs:2026-10-02,3.21,5.8,4,0,review,2026-09-29-->')).toBe(true);
	});

	it('rejects a note that merely contains something card-shaped', () => {
		expect(isCardSource(['reference'], 'A::B')).toBe(false);
	});
});

describe('the schedule comment', () => {
	it('round-trips prosoche’s own format, sibling by sibling', () => {
		const comment = '<!--fsrs:2026-10-02,3.21,5.8,4,0,review,2026-09-29!2026-10-01,1.02,6.3,1,0,learning,2026-09-29-->';
		const entries = parseEntries(comment);
		expect(entries).toEqual([REVIEWED, { due: '2026-10-01', stability: 1.02, difficulty: 6.3, reps: 1, lapses: 0, state: 'learning', last: '2026-09-29' }]);
		expect(formatComment(entries, 0, 2, entries[0]!)).toBe(comment);
	});

	it('reads a side never answered, and one it cannot read, as new', () => {
		expect(parseEntries('<!--fsrs:new!2026-10-02,3.21,5.8,4,0,review,2026-09-29!garbled-->')).toEqual([null, REVIEWED, null]);
	});

	it('reads the plugin’s format, current and older, through fromSm2', () => {
		expect(parseEntries('<!--SR:!2023-09-02,4,270!2023-09-02,5,270-->')).toEqual([fromSm2('2023-09-02', 4, 270), fromSm2('2023-09-02', 5, 270)]);
		expect(parseEntries('<!--SR:2025-12-21,4,270-->')).toEqual([fromSm2('2025-12-21', 4, 270)]);
	});

	it('reads a fractional legacy interval as whole days', () => {
		expect(parseEntries('<!--SR:!2025-12-21,2.5,250-->')).toEqual([fromSm2('2025-12-21', 3, 250)]);
	});

	it('reads the plugin’s magic date as a new sibling', () => {
		expect(parseEntries('<!--SR:!2000-01-01,1,250!2026-10-01,9,290-->')).toEqual([null, fromSm2('2026-10-01', 9, 290)]);
	});

	it('writes unreviewed siblings as new, and a legacy comment whole in the new form', () => {
		expect(formatComment([], 1, 3, REVIEWED)).toBe('<!--fsrs:new!2026-10-02,3.21,5.8,4,0,review,2026-09-29!new-->');
		const legacy = parseEntries('<!--SR:!2026-09-01,10,250!2000-01-01,1,250-->');
		expect(formatComment(legacy, 1, 2, REVIEWED)).toBe('<!--fsrs:2026-09-01,10,5,1,0,review,2026-08-22!2026-10-02,3.21,5.8,4,0,review,2026-09-29-->');
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

	it('rewrites one line, a legacy comment in the new form, and leaves every other byte alone', async () => {
		const before = (await vault.read('CS/Basics.md')).content.split('\n');
		const [card] = scanCards(before.join('\n'), 'CS/Basics.md');
		const result = await review(vault, card, 'good', '2026-09-21');
		expect(result.ok).toBe(true);

		const after = (await vault.read('CS/Basics.md')).content.split('\n');
		const next = outcomes(fromSm2('2026-09-01', 10, 250), '2026-09-21').good.schedule;
		expect(after[3]).toBe(formatComment([], 0, 1, next));
		expect(after[3]).toMatch(/^<!--fsrs:\d{4}-\d{2}-\d{2},[\d.]+,[\d.]+,2,0,review,2026-09-21-->$/);
		expect(after.filter((_, i) => i !== 3)).toEqual(before.filter((_, i) => i !== 3));
	});

	it('inserts one comment line for a card that has never been reviewed', async () => {
		const before = (await vault.read('CS/Basics.md')).content.split('\n');
		const card = scanCards(before.join('\n'), 'CS/Basics.md')[1];
		const result = await review(vault, card, 'easy', '2026-09-21');
		expect(result.ok && result.shift).toEqual({ path: 'CS/Basics.md', afterLine: 5, by: 1 });

		const after = (await vault.read('CS/Basics.md')).content.split('\n');
		expect(after[6]).toBe(formatComment([], 0, 1, outcomes(null, '2026-09-21').easy.schedule));
		expect(after[6]).toMatch(/^<!--fsrs:.*,1,0,review,2026-09-21-->$/);
		expect(after.filter((_, i) => i !== 6)).toEqual(before);
	});

	it('hands back a card that can be graded again straight away', async () => {
		const first = scanCards((await vault.read('CS/Basics.md')).content, 'CS/Basics.md')[1];
		const once = await review(vault, first, 'good', '2026-09-21');
		expect(once.ok).toBe(true);
		if (!once.ok) return;
		const twice = await review(vault, once.card, 'good', '2026-09-21');
		expect(twice.ok).toBe(true);
		const expected = outcomes(outcomes(null, '2026-09-21').good.schedule, '2026-09-21').good.schedule;
		expect(twice.ok && twice.card.schedule).toEqual(expected);
		expect((await vault.read('CS/Basics.md')).content).toContain(formatComment([], 0, 1, expected));
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
		const hard = outcomes(fromSm2('2026-09-02', 20, 250), '2026-09-21').hard.schedule;
		// The graded deletion moves on; its sibling keeps its state, now written in the new form.
		expect((await vault.read('CS/Cloze.md')).content).toContain(formatComment([fromSm2('2026-09-01', 10, 250)], 1, 2, hard));
		expect((await vault.read('CS/Cloze.md')).content).toContain('<!--fsrs:2026-09-01,10,5,1,0,review,2026-08-22!');
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
			index.put(path, note.content, note.mtimeMs);
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
		index.put('Notes/Speech.md', note.content, note.mtimeMs);
		const queue = await dueCards(vault, index, { on: '2026-09-21' });
		expect(queue.invisible.map((i) => i.path)).toEqual(['Notes/Prompting.md']);
	});

	it('honours the limit without lying about the totals', async () => {
		const queue = await dueCards(vault, index, { on: '2026-09-21', limit: 1 });
		expect(queue.cards).toHaveLength(1);
		expect(queue.total).toBe(4);
	});

	it('lists every card file with its goal and counts', async () => {
		await vault.write('Art/Colour.md', '---\ngoal: "[[Goals#Colour theory]]"\n---\n#flashcards\n\nHue::A colour\n');
		const queue = await dueCards(vault, index, { on: '2026-09-21' });
		expect(queue.files).toEqual([
			{ path: 'Art/Colour.md', title: 'Colour', goal: 'Colour theory', cards: 1, due: 1 },
			{ path: 'CS/Due.md', title: 'Due', goal: null, cards: 3, due: 2 }
		]);
	});

	it('lets in only as many unseen cards as a quota allows, in a stable order, and counts the rest as waiting', async () => {
		const art = { folders: ['Art'] };
		const cs = { folders: ['CS'] };
		const one = await dueCards(vault, index, { on: '2026-09-21', newCards: [{ scope: cs, allowance: 0 }, { scope: art, allowance: 1 }] });
		expect(one.cards.map((c) => c.question)).toEqual(['Overdue', 'Hue']);
		expect(one).toMatchObject({ due: 1, fresh: 1, waiting: 1, total: 4 });
		// A file's count is the same rule: CS's new card waits.
		expect(one.files.map((f) => [f.path, f.due])).toEqual([
			['Art/Colour.md', 1],
			['CS/Due.md', 1]
		]);
		const none = await dueCards(vault, index, { on: '2026-09-21', newCards: [] });
		expect(none).toMatchObject({ due: 1, fresh: 0, waiting: 2 });
	});

	it('picks a goal’s new cards from the subject’s, so the two reviews agree', async () => {
		await vault.write('CS/Due.md', `---\ngoal: Systems\n---\n${(await vault.read('CS/Due.md')).content}More::new\n`);
		await vault.write('CS/Aa.md', '#flashcards\n\nFirst::by path\n');
		const quota = [{ scope: { folders: ['CS'] }, allowance: 1 }];
		const subject = await dueCards(vault, index, { on: '2026-09-21', scope: { folders: ['CS'] }, newCards: quota });
		expect(subject.cards.map((c) => c.question)).toEqual(['Overdue', 'First']);
		// CS/Aa.md comes first by path and names no goal, so the goal gets no new card today.
		const goal = await dueCards(vault, index, { on: '2026-09-21', scope: { folders: ['CS'] }, newCards: quota, goal: 'systems' });
		expect(goal.cards.map((c) => c.question)).toEqual(['Overdue']);
		expect(goal).toMatchObject({ fresh: 0, waiting: 2 });
	});

	it('reviews one goal’s files, matching the goal whatever its case, and still lists every file', async () => {
		await vault.write('CS/Due.md', `---\ngoal: Computer systems\n---\n${(await vault.read('CS/Due.md')).content}`);
		const queue = await dueCards(vault, index, { on: '2026-09-21', goal: 'Computer Systems' });
		expect(queue.cards.map((c) => c.question)).toEqual(['Overdue', 'New']);
		expect(queue).toMatchObject({ due: 1, fresh: 1, total: 3 });
		expect(queue.files.map((f) => f.path)).toEqual(['Art/Colour.md', 'CS/Due.md']);
	});
});

describe('fileGoal', () => {
	it.each([
		[{ goal: 'Networks' }, 'Networks'],
		[{ goal: '  Networks ' }, 'Networks'],
		[{ goal: '[[Goals#Networks]]' }, 'Networks'],
		[{ goal: ['Networks', 'Other'] }, 'Networks'],
		[{ goal: '' }, null],
		[{ goal: null }, null],
		[{}, null]
	])('reads %j as %j', (frontmatter, goal) => {
		expect(fileGoal(frontmatter)).toBe(goal);
	});
});

describe('setCardFileGoal', () => {
	let root: string;
	let vault: Vault;
	const SCOPE = { folders: ['CS'] };

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-goal-'));
		vault = new Vault(root);
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('sets, changes and clears one frontmatter line, and nothing else', async () => {
		const body = '#flashcards\n\nQ::A\n<!--SR:!2026-09-01,4,250-->\n';
		await vault.write('CS/Cards.md', `---\ndeck: x\n---\n${body}`);
		expect(await setCardFileGoal(vault, SCOPE, 'CS/Cards.md', 'Networks')).toEqual({ ok: true });
		expect((await vault.read('CS/Cards.md')).content).toBe(`---\ndeck: x\ngoal: Networks\n---\n${body}`);
		await setCardFileGoal(vault, SCOPE, 'CS/Cards.md', 'Operating Systems');
		expect((await vault.read('CS/Cards.md')).content).toBe(`---\ndeck: x\ngoal: Operating Systems\n---\n${body}`);
		await setCardFileGoal(vault, SCOPE, 'CS/Cards.md', null);
		expect((await vault.read('CS/Cards.md')).content).toBe(`---\ndeck: x\ngoal:\n---\n${body}`);
	});

	it('gives a note with no frontmatter a block of its own', async () => {
		await vault.write('CS/Cards.md', '#flashcards\n\nQ::A\n');
		await setCardFileGoal(vault, SCOPE, 'CS/Cards.md', 'Networks');
		expect((await vault.read('CS/Cards.md')).content).toBe('---\ngoal: Networks\n---\n\n#flashcards\n\nQ::A\n');
	});

	it('refuses a note outside the scope, one with no cards, and one that is not there', async () => {
		await vault.write('Art/Cards.md', '#flashcards\n\nQ::A\n');
		await vault.write('CS/Plain.md', 'Just prose.\n');
		expect(await setCardFileGoal(vault, SCOPE, 'Art/Cards.md', 'X')).toEqual({ ok: false, reason: 'not-cards' });
		expect(await setCardFileGoal(vault, SCOPE, 'CS/Plain.md', 'X')).toEqual({ ok: false, reason: 'not-cards' });
		expect(await setCardFileGoal(vault, SCOPE, 'CS/Missing.md', 'X')).toEqual({ ok: false, reason: 'no-note' });
		expect((await vault.read('Art/Cards.md')).content).toBe('#flashcards\n\nQ::A\n');
	});
});
