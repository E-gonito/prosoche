import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { parseBoard, parseCardLine } from '../parse/kanban';
import { changeReadingList, DEFAULT_READING_LIST, itemWords, kindLabels, readItem, readReadingList } from './reading';
import type { Subject } from './subjects';
import type { ReadingFields, ReadingOp } from '$lib/shared/study';

/** A card line as the kanban grammar reads it, for `readItem`. */
function card(line: string) {
	const parsed = parseCardLine(line)!;
	return { line: 0, title: parsed.title, labels: parsed.labels, done: parsed.checkChar !== ' ' };
}

describe('readItem', () => {
	it.each([
		[
			'the spec’s example',
			'- [ ] [CS:APP](https://csapp.cs.cmu.edu) [[Goals#Computer Systems]] #book',
			{ title: 'CS:APP', url: 'https://csapp.cs.cmu.edu', kind: 'book', goal: 'Computer Systems' }
		],
		['the kind written before the goal', '- [ ] [SICP](https://x.io) #book [[Goals#Lisp]]', { title: 'SICP', kind: 'book', goal: 'Lisp' }],
		['plain words, no link, no goal, no kind', '- [ ] The Pragmatic Programmer', { title: 'The Pragmatic Programmer', url: null, kind: 'other', goal: null }],
		['a bare link', '- [ ] https://example.com/talk #video', { title: 'https://example.com/talk', url: 'https://example.com/talk', kind: 'video' }],
		['an escaped bracket in the title', '- [ ] [A \\[draft\\] paper](https://x.io/p) #paper', { title: 'A [draft] paper', url: 'https://x.io/p', kind: 'paper' }],
		['a URL in angle brackets', '- [ ] [Notes](<https://x.io/a b>)', { title: 'Notes', url: 'https://x.io/a b' }],
		['a kind in capitals, among other labels', '- [ ] Talk #fave #Video', { title: 'Talk', kind: 'video' }],
		['a goal link with a path and an alias', '- [ ] Book [[Study/CS/Goals#Networks|nets]]', { title: 'Book', goal: 'Networks' }],
		['a wikilink that is not a goal, kept in the title', '- [ ] [[My book note]]', { title: '[[My book note]]', goal: null }],
		['a ticked item', '- [x] Done reading', { done: true, title: 'Done reading' }]
	])('reads %s', (_name, line, expected) => {
		expect(readItem(card(line))).toMatchObject(expected);
	});
});

describe('itemWords', () => {
	it.each<[string, Pick<ReadingFields, 'title' | 'url' | 'goal'>, string]>([
		['a linked title and a goal', { title: 'CS:APP', url: 'https://csapp.cs.cmu.edu', goal: 'Computer Systems' }, '[CS:APP](https://csapp.cs.cmu.edu) [[Goals#Computer Systems]]'],
		['plain words', { title: '  The   Pragmatic Programmer ', url: null, goal: null }, 'The Pragmatic Programmer'],
		['a link with no title, bare', { title: '', url: 'https://x.io/talk', goal: null }, 'https://x.io/talk'],
		['brackets escaped', { title: 'A [draft]', url: 'https://x.io', goal: null }, '[A \\[draft\\]](https://x.io)'],
		['a URL with a space', { title: 'Notes', url: 'https://x.io/a b', goal: null }, '[Notes](<https://x.io/a b>)']
	])('writes %s', (_name, fields, expected) => {
		expect(itemWords(fields)).toBe(expected);
	});

	it.each([
		{ title: 'CS:APP', url: 'https://csapp.cs.cmu.edu', goal: 'Computer Systems' },
		{ title: 'A [draft] paper', url: 'https://x.io/(p)', goal: null },
		{ title: 'Plain', url: null, goal: 'Tagalog verbs' },
		{ title: 'https://x.io', url: 'https://x.io', goal: null }
	])('reads back what it writes: %j', (fields) => {
		expect(readItem(card(`- [ ] ${itemWords(fields)}`))).toMatchObject(fields);
	});
});

describe('kindLabels', () => {
	it('swaps the kind label and keeps the rest', () => {
		expect(kindLabels(['fave', 'Book'], 'video')).toEqual(['fave', 'video']);
		expect(kindLabels(['book'], 'other')).toEqual([]);
		expect(kindLabels([], 'paper')).toEqual(['paper']);
	});
});

describe('the reading list file', () => {
	let root: string;
	let vault: Vault;
	const SUBJECT: Subject = {
		slug: 'cs',
		name: 'CS',
		color: '#000',
		home: 'Study/CS',
		scope: { folders: ['Study/CS'] },
		path: '_hub/subjects/cs.md',
		files: { goals: 'Study/CS/Goals.md', reading: 'Study/CS/Reading List.md' }
	};
	const PATH = SUBJECT.files.reading;
	const LIST = [
		'---',
		'',
		'kanban-plugin: board',
		'',
		'---',
		'',
		'## To read',
		'',
		'- [ ] [CS:APP](https://csapp.cs.cmu.edu) [[Goals#Computer Systems]] #book',
		'- [ ] The Pragmatic Programmer',
		'',
		'## Reading',
		'',
		'- [ ] [SICP](https://x.io) #course',
		'',
		'## Paused',
		'',
		'## Done',
		'',
		'**Complete**',
		''
	].join('\n');

	async function change(op: ReadingOp) {
		const list = await readReadingList(vault, SUBJECT);
		const result = await changeReadingList(vault, SUBJECT, list.hash, op);
		if (!result.ok) throw new Error(result.reason);
		return { list: result.list, content: (await vault.read(PATH)).content };
	}

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-reading-'));
		vault = new Vault(root);
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('reads a missing file as the four columns, empty, without writing', async () => {
		const list = await readReadingList(vault, SUBJECT);
		expect(list).toMatchObject({ subject: 'cs', path: PATH, exists: false });
		expect(list.groups.map((g) => g.title)).toEqual(['To read', 'Reading', 'Paused', 'Done']);
		expect((await vault.read(PATH)).exists).toBe(false);
		expect(parseBoard(DEFAULT_READING_LIST).columns[3].complete).toBe(true);
	});

	it('writes the first item into the default file', async () => {
		const { content, list } = await change({ kind: 'add', group: 0, item: { title: 'CS:APP', url: 'https://csapp.cs.cmu.edu', kind: 'book', goal: 'Computer Systems' } });
		expect(content).toBe(DEFAULT_READING_LIST.replace('## To read\n\n', '## To read\n\n- [ ] [CS:APP](https://csapp.cs.cmu.edu) [[Goals#Computer Systems]] #book\n'));
		expect(list.groups[0].items[0]).toMatchObject({ title: 'CS:APP', kind: 'book', goal: 'Computer Systems' });
	});

	it('adds an item whose title holds a date word without reading it as a due date', async () => {
		const { content } = await change({ kind: 'add', group: 1, item: { title: 'Rust today', url: null, kind: 'other', goal: null } });
		expect(content).toContain('## Reading\n\n- [ ] Rust today\n');
	});

	it.each<[string, ReadingFields, string]>([
		['the kind alone', { title: 'CS:APP', url: 'https://csapp.cs.cmu.edu', kind: 'video', goal: 'Computer Systems' }, '- [ ] [CS:APP](https://csapp.cs.cmu.edu) [[Goals#Computer Systems]] #video'],
		['the goal alone', { title: 'CS:APP', url: 'https://csapp.cs.cmu.edu', kind: 'book', goal: 'Operating Systems' }, '- [ ] [CS:APP](https://csapp.cs.cmu.edu) [[Goals#Operating Systems]] #book'],
		['the link removed and the kind set to other', { title: 'CS:APP', url: null, kind: 'other', goal: 'Computer Systems' }, '- [ ] CS:APP [[Goals#Computer Systems]]']
	])('edits %s, rewriting only that line', async (_name, item, expected) => {
		await vault.write(PATH, LIST);
		const { content } = await change({ kind: 'edit', line: 8, item });
		expect(content).toBe(LIST.replace('- [ ] [CS:APP](https://csapp.cs.cmu.edu) [[Goals#Computer Systems]] #book', expected));
	});

	it('writes nothing for an edit that changes nothing', async () => {
		await vault.write(PATH, LIST);
		const before = (await vault.read(PATH)).mtimeMs;
		const { content } = await change({ kind: 'edit', line: 9, item: { title: 'The Pragmatic Programmer', url: null, kind: 'other', goal: null } });
		expect(content).toBe(LIST);
		expect((await vault.read(PATH)).mtimeMs).toBe(before);
	});

	it('moves an item to Done, ticking it, and reorders within a group', async () => {
		await vault.write(PATH, LIST);
		const moved = await change({ kind: 'move', line: 13, group: 3, index: 0 });
		expect(moved.content).toContain('**Complete**\n- [x] [SICP](https://x.io) #course\n');
		const reordered = await change({ kind: 'move', line: 9, group: 0, index: 0 });
		expect(reordered.list.groups[0].items.map((i) => i.title)).toEqual(['The Pragmatic Programmer', 'CS:APP']);
	});

	it('deletes an item and nothing else', async () => {
		await vault.write(PATH, LIST);
		const { content } = await change({ kind: 'delete', line: 9 });
		expect(content).toBe(LIST.replace('- [ ] The Pragmatic Programmer\n', ''));
	});

	it('refuses a stale hash, an item with no title and an op it does not know', async () => {
		await vault.write(PATH, LIST);
		const seen = await readReadingList(vault, SUBJECT);
		expect(await changeReadingList(vault, SUBJECT, seen.hash, { kind: 'add', group: 0, item: { title: ' ', url: null, kind: 'book', goal: null } })).toMatchObject({ ok: false, reason: 'refused' });
		expect(await changeReadingList(vault, SUBJECT, seen.hash, { kind: 'explode' } as unknown as ReadingOp)).toMatchObject({ ok: false, reason: 'refused' });
		await vault.write(PATH, LIST.replace('SICP', 'HtDP'));
		const stale = await changeReadingList(vault, SUBJECT, seen.hash, { kind: 'delete', line: 9 });
		expect(stale).toMatchObject({ ok: false, reason: 'conflict' });
		expect(stale.list.groups[1].items[0].title).toBe('HtDP');
	});
});
