import { describe, it, expect } from 'vitest';
import { parseTaskLine, scanTasks, rewriteTaskLine, durationMinutes } from './task';

// These fixtures reproduce, character for character, the line shapes found in
// a real Day Planner vault: the trailing spaces, the backticked quadrant, the
// tasks with no time. Only the wording is invented. The shapes are what the
// parser must not break, and `vault-conformance.test.ts` checks them against a
// real vault when one is available.
const REAL = {
	done: '- [x] 09:30 - 10:00 Morning stretch `Q1`',
	todo: '- [ ] 23:00 - 23:10 Write the daily log `Q1`',
	trailingSpace: '- [ ] Plan tomorrow before bed `Q1` ',
	noTime: '- [ ] Walk the dog, refill the water, sweep the yard `Q1`',
	bare: '- [ ] Twenty push ups, pull ups or squats',
	noQuadrant: '- [x] 10:40 - 18:00 Client project',
	twoSpaces: '- [ ] Draft the new menu `Q1`  '
};

describe('parseTaskLine', () => {
	it('reads a scheduled, completed task', () => {
		const t = parseTaskLine(REAL.done)!;
		expect(t.status).toBe('done');
		expect(t.start).toBe('09:30');
		expect(t.end).toBe('10:00');
		expect(t.text).toBe('Morning stretch');
		expect(t.quadrant).toBe(1);
	});

	it('reads an unscheduled task', () => {
		const t = parseTaskLine(REAL.noTime)!;
		expect(t.start).toBeNull();
		expect(t.text).toBe('Walk the dog, refill the water, sweep the yard');
		expect(t.quadrant).toBe(1);
	});

	it('treats a missing quadrant as null rather than a default', () => {
		expect(parseTaskLine(REAL.bare)!.quadrant).toBeNull();
		expect(parseTaskLine(REAL.noQuadrant)!.quadrant).toBeNull();
	});

	it('requires the quadrant to be inline code, not a bare token', () => {
		expect(parseTaskLine('- [ ] Read a book Q1')!.quadrant).toBeNull();
		expect(parseTaskLine('- [ ] Read a book `Q2`')!.quadrant).toBe(2);
	});

	it('is not fooled by prose, headings or plain bullets', () => {
		expect(parseTaskLine('## Backlog')).toBeNull();
		expect(parseTaskLine('- just a bullet')).toBeNull();
		expect(parseTaskLine('Some prose [x] with brackets')).toBeNull();
	});

	it('computes duration, including a range crossing midnight', () => {
		expect(durationMinutes(parseTaskLine(REAL.noQuadrant)!)).toBe(440);
		expect(durationMinutes(parseTaskLine('- [ ] 23:30 - 00:30 Late')!)).toBe(60);
		expect(durationMinutes(parseTaskLine(REAL.bare)!)).toBeNull();
	});
});

describe('scanTasks', () => {
	const NOTE = [
		'# Tasks',
		REAL.done,
		REAL.todo,
		'\t- What am I avoiding, and why',
		'\t- What went badly, and what I control',
		REAL.bare,
		'## Backlog',
		'```',
		'- [ ] Start the algorithms course `Q1` ',
		'- [ ] Driving licence `Q2` ',
		'```',
		''
	].join('\n');

	it('finds the tasks outside the fence', () => {
		const open = scanTasks(NOTE).filter((t) => !t.fenced);
		expect(open.map((t) => t.text)).toEqual([
			'Morning stretch',
			'Write the daily log',
			'Twenty push ups, pull ups or squats'
		]);
	});

	it('marks the fenced Backlog rather than dropping it', () => {
		const fenced = scanTasks(NOTE).filter((t) => t.fenced);
		expect(fenced.map((t) => t.text)).toEqual(['Start the algorithms course', 'Driving licence']);
	});

	it('gives a task ownership of its indented sub-bullets', () => {
		const journal = scanTasks(NOTE).find((t) => t.text.startsWith('Write the daily log'))!;
		expect(journal.line).toBe(2);
		expect(journal.blockEnd).toBe(4);
	});

	it('does not extend a block over the next task', () => {
		const first = scanTasks(NOTE)[0];
		expect(first.blockEnd).toBe(first.line);
	});
});

describe('rewriteTaskLine', () => {
	it('ticks a task and changes nothing else', () => {
		expect(rewriteTaskLine(REAL.todo, { status: 'done' })).toBe(
			'- [x] 23:00 - 23:10 Write the daily log `Q1`'
		);
	});

	it('preserves trailing whitespace exactly', () => {
		expect(rewriteTaskLine(REAL.trailingSpace, { status: 'done' })).toBe(
			'- [x] Plan tomorrow before bed `Q1` '
		);
		expect(rewriteTaskLine(REAL.twoSpaces, { status: 'in-progress' })).toBe(
			'- [/] Draft the new menu `Q1`  '
		);
	});

	it('moves a time range without touching the text', () => {
		expect(rewriteTaskLine(REAL.done, { time: { start: '11:00', end: '11:45' } })).toBe(
			'- [x] 11:00 - 11:45 Morning stretch `Q1`'
		);
	});

	it('schedules a task that had no time', () => {
		expect(rewriteTaskLine(REAL.noTime, { time: { start: '7:05', end: '07:35' } })).toBe(
			'- [ ] 07:05 - 07:35 Walk the dog, refill the water, sweep the yard `Q1`'
		);
	});

	it('unschedules a task', () => {
		expect(rewriteTaskLine(REAL.done, { time: null })).toBe('- [x] Morning stretch `Q1`');
	});

	it('writes the quadrant back as inline code', () => {
		expect(rewriteTaskLine(REAL.bare, { quadrant: 2 })).toBe(
			'- [ ] Twenty push ups, pull ups or squats `Q2`'
		);
		expect(rewriteTaskLine(REAL.done, { quadrant: 3 })).toBe(
			'- [x] 09:30 - 10:00 Morning stretch `Q3`'
		);
	});

	it('adds a quadrant before trailing whitespace, not after it', () => {
		expect(rewriteTaskLine('- [ ] Look into insurance ', { quadrant: 1 })).toBe('- [ ] Look into insurance `Q1` ');
	});

	it('clears a quadrant and the space before it', () => {
		expect(rewriteTaskLine(REAL.done, { quadrant: null })).toBe('- [x] 09:30 - 10:00 Morning stretch');
	});

	it('applies several edits at once', () => {
		expect(rewriteTaskLine(REAL.bare, { status: 'done', time: { start: '18:00', end: '19:30' }, quadrant: 2 })).toBe(
			'- [x] 18:00 - 19:30 Twenty push ups, pull ups or squats `Q2`'
		);
	});

	it('leaves a non-task line alone', () => {
		expect(rewriteTaskLine('## Backlog', { status: 'done' })).toBe('## Backlog');
	});

	it('leaves emoji fields it does not model untouched', () => {
		const line = '- [ ] 09:00 - 09:30 Review the draft `Q2` 📅 2026-09-23 🆔 a1b2c3';
		expect(rewriteTaskLine(line, { status: 'done' })).toBe(
			'- [x] 09:00 - 09:30 Review the draft `Q2` 📅 2026-09-23 🆔 a1b2c3'
		);
	});
});

// Tags, ids, dependencies and due dates. A board needs to know which
// workspace claims a line and what it waits on, and the Blocked lens needs to
// follow one task to another, so these are read from the line rather than
// held anywhere else.
describe('fields and tags', () => {
	const full = '- [/] 09:00 - 09:30 Review the draft `Q2` #ws/work 📅 2026-09-23 🆔 a1b2 ⛔ c3d4,e5f6 🔁 every other week';

	it('reads every field on a full line', () => {
		const t = parseTaskLine(full)!;
		expect(t.text).toBe('Review the draft');
		expect(t.quadrant).toBe(2);
		expect(t.tags).toEqual(['ws/work']);
		expect(t.due).toBe('2026-09-23');
		expect(t.id).toBe('a1b2');
		expect(t.blockedBy).toEqual(['c3d4', 'e5f6']);
	});

	it('keeps a recurrence rule whole, rather than one token of it', () => {
		const recurrence = parseTaskLine(full)!.spans.fields.find((f) => f.marker === '🔁')!;
		expect(recurrence.value).toBe('every other week');
		expect(full.slice(recurrence.start, recurrence.end)).toBe('🔁 every other week');
	});

	it('reports no tags, id, blocker or due date as empty rather than absent', () => {
		const t = parseTaskLine(REAL.bare)!;
		expect(t.tags).toEqual([]);
		expect(t.id).toBeNull();
		expect(t.blockedBy).toEqual([]);
		expect(t.due).toBeNull();
	});

	it('does not read a tag out of inline code', () => {
		expect(parseTaskLine('- [ ] Explain `#define` to myself `Q3`')!.tags).toEqual([]);
	});

	it('reads several tags, nested ones included', () => {
		expect(parseTaskLine('- [ ] Ship it #ws/work #col/review #pin')!.tags).toEqual([
			'ws/work',
			'col/review',
			'pin'
		]);
	});

	it('stops the text at the metadata, not at the first word it recognises', () => {
		// `Q1` here is part of what the user wrote, not a trailing quadrant, and
		// the words must survive a rename untouched.
		const t = parseTaskLine('- [ ] Ask why `Q1` means urgent and important `Q1` #ws/work')!;
		expect(t.text).toBe('Ask why `Q1` means urgent and important');
	});

	it('treats a token it does not model as part of the text', () => {
		expect(parseTaskLine('- [ ] Pay the bill £42.50 `Q1`')!.text).toBe('Pay the bill £42.50');
	});
});

describe('rewriting fields and tags', () => {
	it('renames a task and leaves its metadata in place', () => {
		expect(
			rewriteTaskLine('- [ ] 09:00 - 09:30 Old wording `Q2` #ws/work 📅 2026-09-23', { text: 'New wording' })
		).toBe('- [ ] 09:00 - 09:30 New wording `Q2` #ws/work 📅 2026-09-23');
	});

	it('ignores an empty rename rather than emptying the line', () => {
		expect(rewriteTaskLine(REAL.done, { text: '   ' })).toBe(REAL.done);
	});

	it('adds and replaces a due date', () => {
		expect(rewriteTaskLine(REAL.bare, { due: '2026-10-01' })).toBe(
			'- [ ] Twenty push ups, pull ups or squats 📅 2026-10-01'
		);
		expect(rewriteTaskLine('- [ ] Renew it 📅 2026-09-23 `Q1`', { due: '2026-12-31' })).toBe(
			'- [ ] Renew it 📅 2026-12-31 `Q1`'
		);
	});

	it('clears a due date and the space in front of it', () => {
		expect(rewriteTaskLine('- [ ] Renew it 📅 2026-09-23', { due: null })).toBe('- [ ] Renew it');
	});

	it('writes a quadrant before the emoji fields, where this vault puts it', () => {
		expect(rewriteTaskLine('- [ ] Renew it 📅 2026-09-23', { quadrant: 1 })).toBe(
			'- [ ] Renew it `Q1` 📅 2026-09-23'
		);
	});

	it('records a dependency, and clears it with an empty list', () => {
		expect(rewriteTaskLine(REAL.bare, { blockedBy: ['a1b2'] })).toBe(
			'- [ ] Twenty push ups, pull ups or squats ⛔ a1b2'
		);
		expect(rewriteTaskLine('- [ ] Wait ⛔ a1b2,c3d4 `Q1`', { blockedBy: [] })).toBe('- [ ] Wait `Q1`');
	});

	it('adds a tag once, however many times it is asked for', () => {
		const once = rewriteTaskLine(REAL.bare, { addTags: ['ws/work'] });
		expect(once).toBe('- [ ] Twenty push ups, pull ups or squats #ws/work');
		expect(rewriteTaskLine(once, { addTags: ['ws/work'] })).toBe(once);
	});

	it('swaps one column tag for another, which is what moving a card does', () => {
		expect(
			rewriteTaskLine('- [ ] Ship it #ws/work #col/doing `Q1`', {
				removeTags: ['col/doing'],
				addTags: ['col/review']
			})
		).toBe('- [ ] Ship it #ws/work `Q1` #col/review');
	});

	it('removes a tag that is not there without touching the line', () => {
		expect(rewriteTaskLine(REAL.done, { removeTags: ['pin'] })).toBe(REAL.done);
	});

	it('pins and unpins, leaving trailing whitespace alone', () => {
		const pinned = rewriteTaskLine(REAL.trailingSpace, { addTags: ['pin'] });
		expect(pinned).toBe('- [ ] Plan tomorrow before bed `Q1` #pin ');
		expect(rewriteTaskLine(pinned, { removeTags: ['pin'] })).toBe(REAL.trailingSpace);
	});

	it('applies a status change and a new field in one pass', () => {
		expect(rewriteTaskLine(REAL.todo, { status: 'done', id: 'z9', addTags: ['ws/personal'] })).toBe(
			'- [x] 23:00 - 23:10 Write the daily log `Q1` 🆔 z9 #ws/personal'
		);
	});
});
