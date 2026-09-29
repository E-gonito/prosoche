import { describe, expect, it } from 'vitest';
import { applyOp, DEFAULT_BOARD, parseBoard, parseCardLine, parseQuickAdd } from './kanban';
import type { BoardOp } from '$lib/shared/kanban';

/** The spec's example, as a person might have it after using the plugin. */
const BOARD = `---

kanban-plugin: basic

---

## To do

- [ ] Order menu printing @{2026-10-03} \`Q1\` #print
	Two quotes so far; ask Print Co for a third.
- [ ] Call the landlord

## Doing

- [ ] Supplier price sheet @{2026-10-01}

## Done

- [x] Register business name


%% kanban:settings
\`\`\`
{"kanban-plugin":"basic"}
\`\`\`
%%`;

const TODAY = '2026-09-29'; // a Tuesday

function apply(content: string, op: BoardOp): string {
	const result = applyOp(content, op, TODAY);
	if (!result.ok) throw new Error(`${result.reason}: ${result.message}`);
	return result.content;
}

/** What changed between two versions, as removed and added lines. */
function diff(before: string, after: string): { removed: string[]; added: string[] } {
	const a = before.split('\n');
	const b = after.split('\n');
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	return { removed: a.slice(start, endA), added: b.slice(start, endB) };
}

/**
 * The plugin's own `boardToMd` for a board of empty lanes, transcribed from
 * `src/parsers/formats/list.ts` and `src/parsers/common.ts`, so the default
 * board is checked against the serialiser rather than against itself.
 */
function pluginBoardToMd(lanes: string[]): string {
	const frontmatter = ['---', '', 'kanban-plugin: board\n', '---', '', ''].join('\n');
	const laneMd = lanes.map((title) => [`## ${title}`, '', '', '', ''].join('\n')).join('');
	const settings = ['', '', '%% kanban:settings', '```', JSON.stringify({ 'kanban-plugin': 'board' }), '```', '%%'].join('\n');
	return frontmatter + laneMd + settings;
}

describe('DEFAULT_BOARD', () => {
	it('is exactly what the plugin writes for To do, Doing and Done', () => {
		expect(DEFAULT_BOARD).toBe(pluginBoardToMd(['To do', 'Doing', 'Done']));
	});

	it('reads as three empty columns', () => {
		const board = parseBoard(DEFAULT_BOARD);
		expect(board.columns.map((c) => c.title)).toEqual(['To do', 'Doing', 'Done']);
		expect(board.columns.every((c) => c.cards.length === 0)).toBe(true);
		expect(board.settings).toEqual({ 'kanban-plugin': 'board' });
	});
});

describe('parseBoard', () => {
	const board = parseBoard(BOARD);

	it('reads each heading as a column, and stops at the settings footer', () => {
		expect(board.columns.map((c) => c.title)).toEqual(['To do', 'Doing', 'Done']);
		expect(board.columns.map((c) => c.cards.length)).toEqual([2, 1, 1]);
		expect(BOARD.split('\n')[board.tail]).toBe('%% kanban:settings');
	});

	it('reads a card: title, due date, priority, labels and notes', () => {
		expect(board.columns[0].cards[0]).toMatchObject({
			line: 8,
			end: 10,
			title: 'Order menu printing',
			due: '2026-10-03',
			priority: 1,
			labels: ['print'],
			notes: 'Two quotes so far; ask Print Co for a third.',
			done: false,
			indent: '\t'
		});
		expect(board.columns[0].cards[1]).toMatchObject({ title: 'Call the landlord', due: null, priority: null, labels: [], notes: '' });
		expect(board.columns[2].cards[0]).toMatchObject({ title: 'Register business name', done: true });
	});

	it('reads the WIP limit and the Complete marker', () => {
		const b = parseBoard('## Doing (3)\n\n- [ ] a\n\n## Done ##\n\n**Complete**\n- [x] b\n');
		expect(b.columns[0]).toMatchObject({ title: 'Doing', limit: 3, complete: false });
		expect(b.columns[1]).toMatchObject({ title: 'Done', limit: 0, complete: true });
	});

	it('leaves the archive out of the columns', () => {
		const b = parseBoard('## A\n\n- [ ] a\n\n***\n\n## Archive\n\n- [x] old\n');
		expect(b.columns.map((c) => c.title)).toEqual(['A']);
		expect(b.columns[0].cards.map((c) => c.title)).toEqual(['a']);
	});

	it('does not read a heading inside a fence', () => {
		const b = parseBoard('## A\n\n```\n## not a column\n- [ ] not a card\n```\n- [ ] a\n');
		expect(b.columns.map((c) => c.title)).toEqual(['A']);
		expect(b.columns[0].cards.map((c) => c.title)).toEqual(['a']);
	});

	it.each([
		['four-space notes', '## A\n- [ ] a\n    one\n    two\n', { notes: 'one\ntwo', indent: '    ', end: 4 }],
		['a blank line inside the notes', '## A\n- [ ] a\n\tone\n\n\ttwo\n\n- [ ] b\n', { notes: 'one\n\ntwo', end: 5 }],
		['a nested list', '## A\n- [ ] a\n  - sub\n- [ ] b\n', { notes: '- sub', end: 3 }],
		['a lazy continuation line', '## A\n- [ ] a\nstill a\n- [ ] b\n', { notes: 'still a', end: 3 }],
		['blank lines after it are not its own', '## A\n- [ ] a\n\n\nprose\n', { notes: '', end: 2 }]
	])('reads a card with %s', (_name, content, expected) => {
		expect(parseBoard(content).columns[0].cards[0]).toMatchObject(expected);
	});

	it('treats prose and plain bullets under a column as content it leaves alone', () => {
		const b = parseBoard('## A\n\nSome words.\n\n- a plain bullet\n- [ ] a card\n');
		expect(b.columns[0].cards.map((c) => c.title)).toEqual(['a card']);
	});

	it('reads a file with no frontmatter, and an empty one', () => {
		expect(parseBoard('## Only\n- [ ] x').columns[0].cards[0].title).toBe('x');
		expect(parseBoard('').columns).toEqual([]);
	});

	it('reads a CRLF file the same way', () => {
		const b = parseBoard(BOARD.replace(/\n/g, '\r\n'));
		expect(b.columns[0].cards[0]).toMatchObject({ title: 'Order menu printing', notes: 'Two quotes so far; ask Print Co for a third.' });
	});
});

describe('parseCardLine', () => {
	it.each([
		['- [ ] Plain', { title: 'Plain', due: null, priority: null, labels: [] }],
		['- [ ] With date @{2026-10-01}', { title: 'With date', due: '2026-10-01' }],
		['- [ ] Linked date @[[2026-10-01]]', { title: 'Linked date', due: '2026-10-01' }],
		['- [ ] Time is words @@{10:00}', { title: 'Time is words @@{10:00}', due: null }],
		['- [ ] Two dates @{2026-10-01} @{2026-10-02}', { due: '2026-10-02', title: 'Two dates @{2026-10-01}' }],
		['- [ ] `Q2` first then words', { priority: 2, title: 'first then words' }],
		['- [ ] Middle @{2026-10-01} token', { title: 'Middle token', due: '2026-10-01' }],
		['- [ ] Tags #a/b #c-d #1 x#y', { labels: ['a/b', 'c-d'], title: 'Tags #1 x#y' }],
		['- [ ] Code `#notatag` #tag', { labels: ['tag'], title: 'Code `#notatag`' }],
		['- [ ] Block id #l ^abc-1', { labels: ['l'], title: 'Block id' }],
		['- [x] Done', { checkChar: 'x', title: 'Done' }],
		['- [ ]', { title: '' }],
		['* [/] Other bullet', { checkChar: '/', title: 'Other bullet' }]
	])('reads %j', (line, expected) => {
		expect(parseCardLine(line)).toMatchObject(expected);
	});

	it.each(['- not a card', '## Heading', '    - [ ] indented is a child, not a card', ''])('refuses %j', (line) => {
		expect(parseCardLine(line)).toBeNull();
	});
});

describe('applyOp: edit-card', () => {
	const at = (content: string, fields: Omit<Extract<BoardOp, { kind: 'edit-card' }>, 'kind' | 'line'>, line = 1) =>
		apply(content, { kind: 'edit-card', line, ...fields });

	it.each([
		['sets a due date after the words', '- [ ] Call `Q1` #x', { due: '2026-10-05' }, '- [ ] Call @{2026-10-05} `Q1` #x'],
		['changes a due date in place', '- [ ] Call @{2026-10-01} #x', { due: '2026-10-05' }, '- [ ] Call @{2026-10-05} #x'],
		['keeps a linked date linked', '- [ ] Call @[[2026-10-01]]', { due: '2026-10-05' }, '- [ ] Call @[[2026-10-05]]'],
		['removes a due date and its space', '- [ ] Call @{2026-10-01} `Q1`', { due: null }, '- [ ] Call `Q1`'],
		['removes a due date that opens the line', '- [ ] @{2026-10-01} Call', { due: null }, '- [ ] Call'],
		['sets a priority after the due date', '- [ ] Call @{2026-10-01} #x', { priority: 2 }, '- [ ] Call @{2026-10-01} `Q2` #x'],
		['sets a priority on a bare card', '- [ ] Call', { priority: 3 }, '- [ ] Call `Q3`'],
		['changes a priority in place', '- [ ] Call `Q1` #x', { priority: 4 }, '- [ ] Call `Q4` #x'],
		['removes a priority', '- [ ] Call `Q1` #x', { priority: null }, '- [ ] Call #x'],
		['adds a label after the last one', '- [ ] Call #a ^id', { labels: ['a', 'b'] }, '- [ ] Call #a #b ^id'],
		['adds a label before a block id', '- [ ] Call ^id', { labels: ['b'] }, '- [ ] Call #b ^id'],
		['removes a label', '- [ ] Call #a #b #c', { labels: ['a', 'c'] }, '- [ ] Call #a #c'],
		['cleans a label', '- [ ] Call', { labels: ['#two words!'] }, '- [ ] Call #two-words'],
		['renames, keeping the tokens', '- [ ] Call @{2026-10-01} `Q1` #x', { title: 'Ring' }, '- [ ] Ring @{2026-10-01} `Q1` #x'],
		['renames, keeping a token from the middle', '- [ ] Call #x the landlord', { title: 'Ring him' }, '- [ ] Ring him #x'],
		['renames an empty card', '- [ ]', { title: 'Now words' }, '- [ ] Now words'],
		['keeps trailing whitespace', '- [ ] Call  ', { priority: 1 }, '- [ ] Call `Q1`  '],
		['changes nothing for no fields', '- [ ] Call #x', {}, '- [ ] Call #x']
	])('%s', (_name, line, fields, expected) => {
		const content = `## A\n${line}\n- [ ] next\n`;
		expect(at(content, fields)).toBe(`## A\n${expected}\n- [ ] next\n`);
	});

	it('writes the notes indented the way the card already indents them', () => {
		expect(at('## A\n- [ ] a\n    old\n- [ ] b\n', { notes: 'new\n\nmore' })).toBe('## A\n- [ ] a\n    new\n\n    more\n- [ ] b\n');
	});

	it('writes new notes with a tab, as Obsidian does', () => {
		expect(at('## A\n- [ ] a\n- [ ] b\n', { notes: 'first' })).toBe('## A\n- [ ] a\n\tfirst\n- [ ] b\n');
	});

	it('removes the notes', () => {
		expect(at('## A\n- [ ] a\n\tone\n\ttwo\n- [ ] b\n', { notes: '' })).toBe('## A\n- [ ] a\n- [ ] b\n');
	});

	it('leaves the notes alone when they are unchanged', () => {
		const content = '## A\n- [ ] a\n  - nested as written\n- [ ] b\n';
		expect(at(content, { notes: '- nested as written' })).toBe(content);
	});

	it('refuses a bad date, an empty title and a line that is not a card', () => {
		expect(applyOp('## A\n- [ ] a\n', { kind: 'edit-card', line: 1, due: '2026-02-30' }, TODAY)).toMatchObject({ ok: false, reason: 'bad-date' });
		expect(applyOp('## A\n- [ ] a\n', { kind: 'edit-card', line: 1, title: '  ' }, TODAY)).toMatchObject({ ok: false, reason: 'no-text' });
		expect(applyOp('## A\n- [ ] a\n', { kind: 'edit-card', line: 0, title: 'x' }, TODAY)).toMatchObject({ ok: false, reason: 'no-card' });
	});

	it('rewrites only the card line of the spec board', () => {
		const next = at(BOARD, { priority: 2, labels: ['print', 'urgent'] }, 8);
		expect(diff(BOARD, next)).toEqual({
			removed: ['- [ ] Order menu printing @{2026-10-03} `Q1` #print'],
			added: ['- [ ] Order menu printing @{2026-10-03} `Q2` #print #urgent']
		});
	});

	it('keeps CRLF line endings', () => {
		const crlf = BOARD.replace(/\n/g, '\r\n');
		const next = at(crlf, { notes: 'one\ntwo' }, 8);
		expect(next).toBe(at(BOARD, { notes: 'one\ntwo' }, 8).replace(/\n/g, '\r\n'));
	});
});

describe('applyOp: toggle-card', () => {
	it('ticks and unticks exactly the checkbox', () => {
		const ticked = apply(BOARD, { kind: 'toggle-card', line: 8, done: true });
		expect(diff(BOARD, ticked).added).toEqual(['- [x] Order menu printing @{2026-10-03} `Q1` #print']);
		expect(apply(ticked, { kind: 'toggle-card', line: 8, done: false })).toBe(BOARD);
	});
});

describe('applyOp: add-card', () => {
	it('appends a quick-added card under the last card of the column', () => {
		const next = apply(BOARD, { kind: 'add-card', column: 0, text: 'Book the van fri Q2 #move' });
		expect(diff(BOARD, next)).toEqual({ removed: [], added: ['- [ ] Book the van @{2026-10-02} `Q2` #move'] });
		expect(parseBoard(next).columns[0].cards[2]).toMatchObject({ title: 'Book the van', line: 11 });
	});

	it('puts the first card of an empty column under its heading, one blank line down', () => {
		const next = apply(DEFAULT_BOARD, { kind: 'add-card', column: 1, text: 'First' });
		expect(next.split('\n').slice(10, 13)).toEqual(['## Doing', '', '- [ ] First']);
		expect(parseBoard(next).columns[1].cards.map((c) => c.title)).toEqual(['First']);
	});

	it('writes a linked date when the board links dates to daily notes', () => {
		const linked = DEFAULT_BOARD.replace('{"kanban-plugin":"board"}', '{"kanban-plugin":"board","link-date-to-daily-note":true}');
		expect(apply(linked, { kind: 'add-card', column: 0, text: 'x today' })).toContain('- [ ] x @[[2026-09-29]]');
	});

	it('puts a card under a **Complete** marker', () => {
		expect(apply('## Done\n\n**Complete**\n\n\n', { kind: 'add-card', column: 0, text: 'y' })).toBe('## Done\n\n**Complete**\n- [ ] y\n\n\n');
	});

	it('refuses a card with no words', () => {
		expect(applyOp(BOARD, { kind: 'add-card', column: 0, text: 'Q1 #tag' }, TODAY)).toMatchObject({ ok: false, reason: 'no-text' });
		expect(applyOp(BOARD, { kind: 'add-card', column: 9, text: 'x' }, TODAY)).toMatchObject({ ok: false, reason: 'no-column' });
	});
});

describe('applyOp: move-card', () => {
	it('moves a card and its notes between columns, byte for byte', () => {
		const next = apply(BOARD, { kind: 'move-card', line: 8, column: 1, index: 1 });
		const b = parseBoard(next);
		expect(b.columns[0].cards.map((c) => c.title)).toEqual(['Call the landlord']);
		expect(b.columns[1].cards.map((c) => c.title)).toEqual(['Supplier price sheet', 'Order menu printing']);
		expect(next).toContain('- [ ] Supplier price sheet @{2026-10-01}\n- [ ] Order menu printing @{2026-10-03} `Q1` #print\n\tTwo quotes so far; ask Print Co for a third.\n');
	});

	it('reorders within a column', () => {
		const next = apply(BOARD, { kind: 'move-card', line: 10, column: 0, index: 0 });
		expect(parseBoard(next).columns[0].cards.map((c) => c.title)).toEqual(['Call the landlord', 'Order menu printing']);
	});

	it('does not tick a card moved into the last column', () => {
		const next = apply(BOARD, { kind: 'move-card', line: 10, column: 2, index: 0 });
		expect(next).toContain('- [ ] Call the landlord\n- [x] Register business name');
	});

	it('ticks a card moved into a **Complete** column, and unticks it moved out', () => {
		const content = '## A\n\n- [ ] a\n\n## Done\n\n**Complete**\n- [x] b\n';
		const into = apply(content, { kind: 'move-card', line: 2, column: 1, index: 1 });
		expect(into).toBe('## A\n\n\n## Done\n\n**Complete**\n- [x] b\n- [x] a\n');
		expect(apply(into, { kind: 'move-card', line: 7, column: 0, index: 0 })).toBe(content);
	});

	it('clamps the index to the column', () => {
		const next = apply(BOARD, { kind: 'move-card', line: 8, column: 2, index: 99 });
		expect(parseBoard(next).columns[2].cards.map((c) => c.title)).toEqual(['Register business name', 'Order menu printing']);
	});

	it('refuses a line that is not a card', () => {
		expect(applyOp(BOARD, { kind: 'move-card', line: 6, column: 1, index: 0 }, TODAY)).toMatchObject({ ok: false, reason: 'no-card' });
	});
});

describe('applyOp: columns', () => {
	it('adds a column at the end, above the blank lines before the footer', () => {
		const next = apply(BOARD, { kind: 'add-column', title: 'Waiting' });
		expect(next).toContain('- [x] Register business name\n\n\n## Waiting\n\n\n%% kanban:settings');
		expect(parseBoard(next).columns.map((c) => c.title)).toEqual(['To do', 'Doing', 'Done', 'Waiting']);
	});

	it('adds a column before another', () => {
		const next = apply(BOARD, { kind: 'add-column', title: 'Next', index: 1 });
		expect(parseBoard(next).columns.map((c) => c.title)).toEqual(['To do', 'Next', 'Doing', 'Done']);
		expect(diff(BOARD, next).removed).toEqual([]);
	});

	it('adds the first column to a board with none', () => {
		const empty = '---\n\nkanban-plugin: board\n\n---\n\n';
		expect(apply(empty, { kind: 'add-column', title: 'To do' })).toBe('---\n\nkanban-plugin: board\n\n---\n\n## To do\n\n\n\n');
	});

	it('renames a column, keeping its WIP limit and heading level', () => {
		expect(apply('### Doing (3) ##\n- [ ] a\n', { kind: 'rename-column', column: 0, title: 'In progress' })).toBe('### In progress (3) ##\n- [ ] a\n');
	});

	it('moves a column and every line it owns', () => {
		const next = apply(BOARD, { kind: 'move-column', column: 0, index: 2 });
		expect(parseBoard(next).columns.map((c) => c.title)).toEqual(['Doing', 'Done', 'To do']);
		expect(parseBoard(next).columns[2].cards[0].notes).toBe('Two quotes so far; ask Print Co for a third.');
		expect(apply(next, { kind: 'move-column', column: 2, index: 0 })).toBe(BOARD);
	});

	it('deletes an empty column, and refuses one with anything in it', () => {
		const added = apply(BOARD, { kind: 'add-column', title: 'Waiting' });
		expect(apply(added, { kind: 'delete-column', column: 3 })).toBe(BOARD);
		const between = apply(BOARD, { kind: 'add-column', title: 'Next', index: 1 });
		expect(apply(between, { kind: 'delete-column', column: 1 })).toBe(BOARD);
		expect(applyOp(BOARD, { kind: 'delete-column', column: 0 }, TODAY)).toMatchObject({ ok: false, reason: 'not-empty' });
		expect(applyOp('## A\n\nA note.\n', { kind: 'delete-column', column: 0 }, TODAY)).toMatchObject({ ok: false, reason: 'not-empty' });
	});
});

describe('applyOp: a malformed op', () => {
	it.each([
		[{ kind: 'explode' }],
		[{ kind: 'move-card', line: '8', column: 1, index: 0 }],
		[{ kind: 'move-card', line: 8, column: 1, index: -1 }],
		[{ kind: 'toggle-card', line: 8 }],
		[{ kind: 'edit-card', line: 8, labels: 'print' }],
		[null]
	])('refuses %j and changes nothing', (op) => {
		expect(applyOp(BOARD, op as unknown as BoardOp, TODAY)).toMatchObject({ ok: false, reason: 'bad-op' });
	});
});

describe('unknown content', () => {
	const MESSY = [
		'---',
		'kanban-plugin: board',
		'tags: [ops]',
		'---',
		'',
		'Intro prose above every column.',
		'',
		'## To do',
		'',
		'A note about this column.',
		'',
		'- [ ] one ^block-1',
		'- a plain bullet the plugin would also show',
		'- [ ] two   ',
		'',
		'> a quote',
		'',
		'## Done',
		'**Complete**',
		'- [x] three',
		'',
		'***',
		'',
		'## Archive',
		'',
		'- [x] archived',
		'',
		'%% kanban:settings',
		'```',
		'{"kanban-plugin":"board","lane-width":300}',
		'```',
		'%%',
		''
	].join('\n');

	it('survives a toggle, an edit and a move there and back, byte for byte', () => {
		let next = apply(MESSY, { kind: 'toggle-card', line: 11, done: true });
		next = apply(next, { kind: 'toggle-card', line: 11, done: false });
		expect(next).toBe(MESSY);
		next = apply(MESSY, { kind: 'edit-card', line: 13, due: '2026-10-01' });
		expect(diff(MESSY, next)).toEqual({ removed: ['- [ ] two   '], added: ['- [ ] two @{2026-10-01}   '] });
		expect(apply(next, { kind: 'edit-card', line: 13, due: null })).toBe(MESSY);
	});

	it('never counts the archive as a column', () => {
		expect(parseBoard(MESSY).columns.map((c) => c.title)).toEqual(['To do', 'Done']);
		expect(parseBoard(MESSY).settings).toEqual({ 'kanban-plugin': 'board', 'lane-width': 300 });
	});
});

describe('parseQuickAdd', () => {
	it.each([
		['Call landlord fri Q1 #legal', { title: 'Call landlord', due: '2026-10-02', priority: 1, labels: ['legal'] }],
		['Pay rent today', { title: 'Pay rent', due: '2026-09-29' }],
		['Pay rent tomorrow', { title: 'Pay rent', due: '2026-09-30' }],
		['Standup tuesday', { title: 'Standup', due: '2026-10-06' }],
		['Standup Mon', { title: 'Standup', due: '2026-10-05' }],
		['File taxes 2026-10-31', { title: 'File taxes', due: '2026-10-31' }],
		['File taxes @{2026-10-31}', { title: 'File taxes', due: '2026-10-31' }],
		['Two days mon fri', { title: 'Two days mon', due: '2026-10-02' }],
		['Not a date 2026-13-01', { title: 'Not a date 2026-13-01', due: null }],
		['q2 lower case', { title: 'lower case', priority: 2 }],
		['#a #b words #a', { title: 'words', labels: ['a', 'b'] }],
		['Issue #12 stays', { title: 'Issue #12 stays', labels: [] }],
		['  spaced   out  ', { title: 'spaced out', due: null, priority: null, labels: [] }]
	])('reads %j', (text, expected) => {
		expect(parseQuickAdd(text, TODAY)).toMatchObject(expected);
	});
});

/**
 * The property the spec asks for: parse a board, move a card out and back,
 * and the bytes are identical. Checked over boards shaped the way the plugin
 * writes them, generated from a fixed seed so a failure reproduces.
 */
describe('round trip', () => {
	function rng(seed: number): () => number {
		let s = seed;
		return () => {
			s = (s * 1103515245 + 12345) & 0x7fffffff;
			return s / 0x7fffffff;
		};
	}

	function randomBoard(random: () => number): string {
		const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
		const columns = 1 + Math.floor(random() * 4);
		let md = '---\n\nkanban-plugin: board\n\n---\n\n';
		for (let c = 0; c < columns; c++) {
			const lines = [`## Column ${c}${random() < 0.2 ? ' (4)' : ''}`, ''];
			if (random() < 0.15) lines.push('**Complete**');
			const cards = Math.floor(random() * 4);
			for (let k = 0; k < cards; k++) {
				const tokens = [pick(['', ' @{2026-10-0' + (1 + k) + '}']), pick(['', ' `Q2`']), pick(['', ' #tag', ' #a #b'])].join('');
				lines.push(`- [${random() < 0.3 ? 'x' : ' '}] Card ${c}.${k}${tokens}`);
				if (random() < 0.4) lines.push(`${pick(['\t', '    '])}note for ${c}.${k}`);
				if (random() < 0.15) lines.push('', `\tsecond paragraph ${c}.${k}`);
			}
			lines.push('', '', '');
			md += lines.join('\n');
		}
		return `${md}\n\n%% kanban:settings\n\`\`\`\n{"kanban-plugin":"board"}\n\`\`\`\n%%`;
	}

	it('moves every card to every place and back without changing a byte', () => {
		const random = rng(42);
		let checked = 0;
		for (let n = 0; n < 60; n++) {
			const content = randomBoard(random);
			const board = parseBoard(content);
			board.columns.forEach((col, c) =>
				col.cards.forEach((card, i) => {
					board.columns.forEach((target, t) => {
						// The index it can go to: any place among the target's cards.
						const room = target.cards.length + (t === c ? 0 : 1);
						for (let to = 0; to < room; to++) {
							// A move that touches a Complete lane leaves the card ticked
							// exactly when its own lane is Complete, as the plugin does,
							// so only a card already in that state comes back unchanged.
							if ((target.complete || col.complete) && card.done !== col.complete) continue;
							const moved = apply(content, { kind: 'move-card', line: card.line, column: t, index: to });
							const back = parseBoard(moved).columns[t].cards[to];
							expect(back.title).toBe(card.title);
							expect(apply(moved, { kind: 'move-card', line: back.line, column: c, index: i })).toBe(content);
							checked++;
						}
					});
				})
			);
		}
		expect(checked).toBeGreaterThan(200);
	});

	it('moves every column to every place and back without changing a byte', () => {
		const random = rng(7);
		for (let n = 0; n < 40; n++) {
			const content = randomBoard(random);
			const count = parseBoard(content).columns.length;
			for (let c = 0; c < count; c++) {
				for (let to = 0; to < count; to++) {
					const moved = apply(content, { kind: 'move-column', column: c, index: to });
					expect(apply(moved, { kind: 'move-column', column: to, index: c })).toBe(content);
				}
			}
		}
	});

	it('adds a column anywhere and deletes it again without changing a byte', () => {
		const random = rng(3);
		for (let n = 0; n < 40; n++) {
			const content = randomBoard(random);
			const count = parseBoard(content).columns.length;
			for (let at = 0; at <= count; at++) {
				const added = apply(content, { kind: 'add-column', title: 'Extra', index: at < count ? at : undefined });
				expect(parseBoard(added).columns[at].title).toBe('Extra');
				expect(apply(added, { kind: 'delete-column', column: at })).toBe(content);
			}
		}
	});
});
