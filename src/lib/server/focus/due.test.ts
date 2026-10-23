import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, hasPlan, nudgesOwed, stripFor, type DueRules } from './due';

const t = (hhmm: string) => {
	const [h, m] = hhmm.split(':').map(Number);
	return h * 60 + m;
};

/** Generic stand-in for a real day: template order, overlaps, a same-start pair, habits, a fenced backlog. */
const RAW = {
	plan: '- [ ] 08:00 - 08:30 Set out tasks for the day `Q1`',
	big: '- [ ] 10:00 - 18:00 Work on project alpha `Q2`',
	habitA: '- [ ] 10:00 - 10:10 Water the plants',
	frontend: '- [ ] 17:00 - 17:30 Learn frontend `Q2`',
	cookA: '- [ ] 18:00 - 18:45 Cook dinner',
	cookB: '- [ ] 18:00 - 19:00 Call a friend',
	habitB: '- [ ] 12:00 - 12:10 Stretch',
	ticked: '- [x] 09:00 - 09:30 Morning walk',
	cancelled: '- [-] 13:00 - 14:00 Dropped idea',
	logged: '- [ ] 15:00 - 15:30 Read a chapter',
	late: '- [ ] 23:00 - 24:00 Wind down for bed',
	untimed: '- [ ] Pay a bill',
	startOnly: '- [ ] 16:00 Phone call'
};

const NOTE = [
	'# Journal',
	'',
	'## Tasks',
	RAW.frontend,
	RAW.big,
	RAW.cookA,
	RAW.cookB,
	RAW.habitA,
	RAW.habitB,
	RAW.ticked,
	RAW.cancelled,
	RAW.plan,
	RAW.logged,
	'\t- Focus: Read a chapter, 25m, skipped',
	RAW.late,
	RAW.untimed,
	RAW.startOnly,
	'',
	'## Backlog',
	'```',
	'- [ ] 11:00 - 11:30 Fenced idea',
	'```',
	''
].join('\n');

const names = (s: { blocks: { text: string }[] } | null) => s?.blocks.map((b) => b.text);

describe('hasPlan', () => {
	it.each([
		['a real-shaped note', NOTE, true],
		['an empty note', '', false],
		['only untimed and fenced', ['- [ ] Pay a bill', '```', '- [ ] 11:00 - 11:30 Fenced', '```'].join('\n'), false],
		['every block ticked or skipped', [RAW.ticked, RAW.cancelled].join('\n'), true],
		['a start-only block', RAW.startOnly, false],
		['one 10-minute habit', RAW.habitA, true]
	])('%s', (_n, content, want) => expect(hasPlan(content as string)).toBe(want));
});

describe('stripFor', () => {
	const strip = (hhmm: string, started: string[] = [], content = NOTE) => stripFor(content, t(hhmm), started);

	it.each([
		['07:44', null],
		['07:45', { state: 'soon', startMin: t('08:00'), text: ['Set out tasks for the day'] }],
		['07:59', { state: 'soon', startMin: t('08:00'), text: ['Set out tasks for the day'] }],
		['08:00', { state: 'due', startMin: t('08:00'), text: ['Set out tasks for the day'] }],
		['08:29', { state: 'due', startMin: t('08:00'), text: ['Set out tasks for the day'] }],
		['08:30', null], // block over; dueFor 30 and end coincide
		['09:30', null], // nothing until 09:45, the ticked walk never counts
		['09:44', null],
		['09:45', { state: 'soon', startMin: t('10:00'), text: ['Work on project alpha', 'Water the plants'] }]
	])('at %s', (at, want) => {
		const s = strip(at);
		if (!want) return expect(s).toBeNull();
		expect(s).toMatchObject({ state: want.state, startMin: want.startMin });
		expect(names(s)).toEqual(want.text);
	});

	it('a same-start pair share one strip, in file order', () => {
		// 10:00 holds the long block and the habit, listed big first then habit in the file.
		const s = strip('10:02')!;
		expect(s.state).toBe('due');
		expect(names(s)).toEqual(['Work on project alpha', 'Water the plants']);
		const evening = strip('18:05')!;
		expect(evening.startMin).toBe(t('18:00'));
		expect(names(evening)).toEqual(['Cook dinner', 'Call a friend']);
	});

	it('due lasts dueForMin from the start, so a long block drops off the strip after 30 minutes', () => {
		expect(strip('10:29')).toMatchObject({ state: 'due', startMin: t('10:00') });
		expect(strip('10:30')).toBeNull();
	});

	it('the most recently started due group wins over an earlier long-lived one', () => {
		const note = ['- [ ] 10:00 - 18:00 Long block', '- [ ] 10:20 - 10:30 Short block'].join('\n');
		expect(names(stripFor(note, t('10:25'), []))).toEqual(['Short block']);
		expect(names(stripFor(note, t('10:15'), []))).toEqual(['Long block']);
		// once the short one ends the long one is past its 30 minutes too
		expect(stripFor(note, t('10:31'), [])).toBeNull();
	});

	it('due beats soon: a due block is shown while another is soon', () => {
		const note = ['- [ ] 10:00 - 11:00 Now block', '- [ ] 10:35 - 11:00 Next block'].join('\n');
		expect(stripFor(note, t('10:25'), [])).toMatchObject({ state: 'due', startMin: t('10:00') });
		expect(stripFor(note, t('10:20'), [])).toMatchObject({ state: 'due' });
	});

	it('of several soon groups the earliest wins', () => {
		const note = ['- [ ] 10:10 - 11:00 Later', '- [ ] 10:05 - 11:00 Earlier'].join('\n');
		expect(names(stripFor(note, t('10:00'), []))).toEqual(['Earlier']);
	});

	it('a block stops being due at its own end when shorter than dueFor', () => {
		expect(strip('12:09')).toMatchObject({ state: 'due', startMin: t('12:00') });
		expect(strip('12:10')).toBeNull();
	});

	it('a group is due until its longest block ends (capped by dueFor)', () => {
		expect(strip('18:29')).toMatchObject({ state: 'due', startMin: t('18:00') });
		expect(strip('18:30')).toBeNull();
	});

	it('ignores untimed, start-only, ticked, cancelled and fenced blocks', () => {
		// 09:00 ticked, 11:00 fenced, 13:00 cancelled, 16:00 start-only: never a strip, even inside their own minute
		for (const hhmm of ['08:45', '09:00', '10:45', '11:00', '12:45', '13:00', '15:45', '16:00']) expect(strip(hhmm)).toBeNull();
	});

	it('handles a 24:00 end', () => {
		expect(strip('23:00')).toMatchObject({ state: 'due', startMin: t('23:00') });
		expect(strip('23:29')).toMatchObject({ state: 'due' });
		expect(strip('23:30')).toBeNull();
		expect(strip('22:50')).toMatchObject({ state: 'soon', startMin: t('23:00') });
	});

	it('a block with a logged-session sub-bullet is started', () => {
		expect(strip('14:55')).toBeNull();
		expect(strip('15:10')).toBeNull();
	});

	it('started by raw: the block is skipped, so is the whole same-start group', () => {
		expect(strip('08:10', [RAW.plan])).toBeNull();
		expect(strip('18:05', [RAW.cookB])).toBeNull();
		expect(strip('18:05', [RAW.cookA])).toBeNull();
		expect(strip('18:05', ['some other line'])).toMatchObject({ state: 'due' });
	});

	it('starting the short block lets the long one back on the strip', () => {
		const note = ['- [ ] 10:00 - 18:00 Long block', '- [ ] 10:20 - 10:30 Short block'].join('\n');
		// the long block is still inside its 30 minutes, so it shows again
		expect(names(stripFor(note, t('10:25'), ['- [ ] 10:20 - 10:30 Short block']))).toEqual(['Long block']);
	});

	it('a sub-bullet outside the block does not count', () => {
		const note = ['- [ ] 10:00 - 10:30 First', '- [ ] 11:00 - 11:30 Second', '\t- Focus: x, 25m, done'].join('\n');
		expect(stripFor(note, t('10:05'), [])).toMatchObject({ state: 'due', startMin: t('10:00') });
		expect(stripFor(note, t('11:05'), [])).toBeNull();
	});

	it('exposes line, blockEnd, raw, text and minutes', () => {
		const s = strip('17:00')!;
		expect(s.blocks).toEqual([{ line: 3, blockEnd: 3, raw: RAW.frontend, text: 'Learn frontend', startMin: t('17:00'), endMin: t('17:30') }]);
	});

	it('honours custom rules', () => {
		const rules: DueRules = { ...DEFAULT_RULES, soonMin: 5, dueForMin: 60 };
		expect(stripFor(NOTE, t('07:54'), [], rules)).toBeNull();
		expect(stripFor(NOTE, t('07:55'), [], rules)).toMatchObject({ state: 'soon' });
		expect(stripFor(NOTE, t('10:45'), [], rules)).toMatchObject({ state: 'due', startMin: t('10:00') });
	});

	it('is null for an empty or planless note', () => {
		expect(stripFor('', t('10:00'), [])).toBeNull();
		expect(stripFor(RAW.untimed, t('10:00'), [])).toBeNull();
	});
});

describe('nudgesOwed', () => {
	const owed = (hhmm: string, started: string[] = [], content = NOTE) => nudgesOwed(content, t(hhmm), started).map((n) => `${n.kind}@${n.startMin}`);
	const one = '- [ ] 17:00 - 17:30 Solo block';

	it.each([
		['16:49', []],
		['16:50', ['wind-down@1020']],
		['16:53', ['wind-down@1020']],
		['16:54', []], // past the grace
		['17:00', ['start@1020']],
		['17:03', ['start@1020']],
		['17:04', []],
		['17:10', ['follow-up@1020']],
		['17:13', ['follow-up@1020']],
		['17:14', []]
	])('single block at %s', (at, want) => expect(owed(at, [], one)).toEqual(want));

	it('the late-grace boundary honours custom grace', () => {
		const rules: DueRules = { ...DEFAULT_RULES, lateGraceMin: 0 };
		expect(nudgesOwed(one, t('17:00'), [], rules)).toHaveLength(1);
		expect(nudgesOwed(one, t('17:01'), [], rules)).toHaveLength(0);
	});

	it('honours custom lead times', () => {
		const rules: DueRules = { ...DEFAULT_RULES, windDownMin: 20, followUpMin: 5 };
		expect(nudgesOwed(one, t('16:40'), [], rules).map((n) => n.kind)).toEqual(['wind-down']);
		expect(nudgesOwed(one, t('17:05'), [], rules).map((n) => n.kind)).toEqual(['follow-up']);
	});

	it('a same-start pair gets one nudge carrying both blocks', () => {
		const n = nudgesOwed(NOTE, t('18:00'), []);
		expect(n).toHaveLength(1);
		expect(n[0].kind).toBe('start');
		expect(n[0].blocks.map((b) => b.text)).toEqual(['Cook dinner', 'Call a friend']);
	});

	it('every kind fires for a mid-day block in the real-shaped note', () => {
		expect(owed('17:50')).toEqual(['wind-down@1080']);
		expect(owed('18:00')).toEqual(['start@1080']);
		expect(owed('18:10')).toEqual(['follow-up@1080']);
	});

	it('two groups can be owed at once, ordered by start', () => {
		const note = ['- [ ] 10:10 - 11:00 Second', '- [ ] 10:00 - 11:00 First'].join('\n');
		// 10:00 start nudge and 10:10-10 = 10:00 wind-down for the second
		expect(nudgesOwed(note, t('10:00'), []).map((n) => `${n.kind}@${n.startMin}`)).toEqual(['start@600', 'wind-down@610']);
	});

	it('no wind-down crosses into yesterday', () => {
		const note = '- [ ] 00:05 - 00:30 Night block';
		expect(nudgesOwed(note, t('00:00'), [])).toEqual([]);
		expect(nudgesOwed(note, t('00:05'), []).map((n) => n.kind)).toEqual(['start']);
		const midnight = '- [ ] 00:00 - 00:30 Midnight block';
		expect(nudgesOwed(midnight, t('00:00'), []).map((n) => n.kind)).toEqual(['start']);
	});

	it('no follow-up once the block has ended', () => {
		const short = '- [ ] 17:00 - 17:10 Habit';
		expect(nudgesOwed(short, t('17:10'), [])).toEqual([]);
		const justOver = '- [ ] 17:00 - 17:11 Habit';
		expect(nudgesOwed(justOver, t('17:10'), []).map((n) => n.kind)).toEqual(['follow-up']);
	});

	it('follow-up uses the group latest end', () => {
		const note = ['- [ ] 17:00 - 17:05 Brief', '- [ ] 17:00 - 17:30 Longer'].join('\n');
		expect(nudgesOwed(note, t('17:10'), []).map((n) => n.kind)).toEqual(['follow-up']);
	});

	it('the 24:00 block is nudged and the follow-up fires', () => {
		expect(owed('22:50')).toEqual(['wind-down@1380']);
		expect(owed('23:10')).toEqual(['follow-up@1380']);
	});

	it('started by raw: nothing is owed for the block or its group', () => {
		expect(owed('18:00', [RAW.cookA])).toEqual([]);
		expect(owed('17:50', [RAW.cookB])).toEqual([]);
		expect(owed('18:10', [RAW.cookB])).toEqual([]);
		expect(owed('18:00', ['unrelated'])).toEqual(['start@1080']);
	});

	it('nothing is owed for a ticked, cancelled, fenced, logged or untimed block', () => {
		expect(owed('09:00')).toEqual([]); // ticked walk
		expect(owed('13:00')).toEqual([]); // cancelled
		expect(owed('11:00')).toEqual([]); // fenced
		expect(owed('15:00')).toEqual([]); // logged skipped session
		expect(owed('14:50')).toEqual([]);
		expect(owed('16:00')).toEqual([]); // start-only
	});

	it('keys are deterministic, distinct per kind and group, and change with the group', () => {
		const a = nudgesOwed(NOTE, t('18:00'), [])[0];
		const again = nudgesOwed(NOTE, t('18:02'), [])[0];
		expect(again.key).toBe(a.key);
		const windDown = nudgesOwed(NOTE, t('17:50'), [])[0];
		expect(windDown.key).not.toBe(a.key);
		const other = nudgesOwed(NOTE, t('17:00'), [])[0];
		expect(other.key).not.toBe(a.key);
		expect(a.key).toMatch(/^start:1080:[0-9a-f]{8}$/);
		const edited = NOTE.replace('Cook dinner', 'Cook lunch');
		expect(nudgesOwed(edited, t('18:00'), [])[0].key).not.toBe(a.key);
	});

	it('a key is pinned so a restart or upgrade never re-sends', () => {
		expect(nudgesOwed(one, t('17:00'), [])[0].key).toBe('start:1020:05243b60');
	});

	it('an empty note owes nothing', () => expect(nudgesOwed('', t('10:00'), [])).toEqual([]));
});
