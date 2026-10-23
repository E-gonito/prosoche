import { describe, expect, it } from 'vitest';
import { clockText, prefixed, startHref, startLink, stripView, type NowStrip } from './focus-now';
import type { Task } from './task';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 21, 17, 0);

const running = (over: Partial<Extract<NowStrip, { state: 'running' }>> = {}): NowStrip => ({
	state: 'running',
	name: 'Fullstack',
	startedAt: T0,
	minutes: 30,
	warmupMin: 5,
	serverNow: T0,
	...over
});
const block = (line: number, text: string) => ({ line, text, startMin: 1020, endMin: 1050 });
const due = (...blocks: ReturnType<typeof block>[]): NowStrip => ({ state: 'due', day: '2026-10-21', startMin: 1020, startAt: T0, blocks, serverNow: T0 });
const soon = (...blocks: ReturnType<typeof block>[]): NowStrip => ({ state: 'soon', day: '2026-10-21', startMin: 1020, startAt: T0, blocks, serverNow: T0 });

describe('clockText', () => {
	it.each([
		[252_000, '4:12'],
		[251_001, '4:12'],
		[0, '0:00'],
		[-1000, '+0:01'],
		[-61_500, '+1:01'],
		[23 * MIN + 41_000, '23:41']
	])('%d ms is %s', (ms, text) => expect(clockText(ms)).toBe(text));
});

describe('a running strip', () => {
	it('counts the warm-up down under its promise, then the time left', () => {
		expect(stripView(running(), T0 + 48_000)).toMatchObject({ href: '/focus', label: 'Just five minutes', detail: '4:12', over: false, titlePrefix: '▶ 4:12 · ' });
		expect(stripView(running(), T0 + 6 * MIN)).toMatchObject({ label: 'Fullstack', detail: '24:00 left', over: false, titlePrefix: '▶ 24:00 · ' });
	});

	it('goes +m:ss and over past the end', () => {
		expect(stripView(running(), T0 + 31 * MIN + 5000)).toMatchObject({ detail: '+1:05', over: true, start: null });
	});
});

describe('a due or soon strip', () => {
	it('says how long ago a block started, offers Start for it, and prefixes the title', () => {
		expect(stripView(due(block(2, 'Cook dinner')), T0 + 4 * MIN + 10_000)).toEqual({
			state: 'due',
			href: '/focus/start?day=2026-10-21&line=2',
			label: 'Cook dinner',
			detail: 'started 4 min ago',
			over: false,
			start: '/focus/start?day=2026-10-21&line=2',
			flipAt: null,
			titlePrefix: 'Due: Cook dinner · '
		});
		expect(stripView(due(block(2, 'Cook dinner')), T0 + 20_000).detail).toBe('started just now');
	});

	it('shares one line between blocks starting together, and sends Start to Today', () => {
		expect(stripView(due(block(3, 'Cusina Ko'), block(4, 'Kaya')), T0 + 2 * MIN)).toMatchObject({
			label: '17:00 · Cusina Ko, Kaya',
			detail: null,
			href: '/today',
			start: '/today',
			titlePrefix: 'Due: 17:00 · Cusina Ko, Kaya · '
		});
	});

	it('counts down to a soon block, links to its start page and has no Start button', () => {
		expect(stripView(soon(block(2, 'Cook dinner')), T0 - (8 * MIN + 12_000))).toEqual({
			state: 'soon',
			href: '/focus/start?day=2026-10-21&line=2',
			label: 'Cook dinner',
			detail: 'in 8:12',
			over: false,
			start: null,
			flipAt: T0,
			titlePrefix: ''
		});
	});
});

describe('prefixed', () => {
	it('puts the prefix on, replaces the last one, and leaves a page’s new title alone', () => {
		expect(prefixed('Today · prosoche', '', '▶ 4:12 · ')).toBe('▶ 4:12 · Today · prosoche');
		expect(prefixed('▶ 4:12 · Today · prosoche', '▶ 4:12 · ', '▶ 4:11 · ')).toBe('▶ 4:11 · Today · prosoche');
		expect(prefixed('▶ 4:12 · Today · prosoche', '▶ 4:12 · ', '')).toBe('Today · prosoche');
		expect(prefixed('Notes · prosoche', '▶ 4:12 · ', 'Due: A · ')).toBe('Due: A · Notes · prosoche');
	});
});

describe('startLink', () => {
	const task = (over: Partial<Task> = {}) => ({ path: 'Journal/2026/10/21.md', line: 7, status: 'todo', startMin: 600, endMin: 660, ...over }) as Task;
	const link = (t: Task, isToday = true) => startLink(t, '2026-10-21', 'Journal/2026/10/21.md', isToday);

	it('links an open, timed task in the viewed note, on today only', () => {
		expect(link(task())).toBe(startHref('2026-10-21', 7));
		expect(link(task({ status: 'in-progress' }))).not.toBeNull();
		expect(link(task(), false)).toBeNull();
	});

	it('refuses a task that is done, cancelled, untimed, backwards or in another note', () => {
		expect(link(task({ status: 'done' }))).toBeNull();
		expect(link(task({ status: 'cancelled' }))).toBeNull();
		expect(link(task({ startMin: null, endMin: null }))).toBeNull();
		expect(link(task({ endMin: 600 }))).toBeNull();
		expect(link(task({ path: 'Other.md' }))).toBeNull();
	});
});
