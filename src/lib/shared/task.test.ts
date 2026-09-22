import { describe, it, expect } from 'vitest';
import { displayText, matchKey, taskMinutes, isOpen, type Task } from './task';

const task = (over: Partial<Task> = {}): Task => ({
	path: 'a.md',
	line: 0,
	blockEnd: 0,
	status: 'todo',
	startMin: null,
	endMin: null,
	tags: [],
	id: null,
	blockedBy: [],
	due: null,
	text: '',
	quadrant: null,
	fenced: false,
	raw: '',
	...over
});

describe('displayText', () => {
	it('unwraps the bold this vault uses inside task lines', () => {
		expect(displayText('**Indexing & Sharding:**')).toBe('Indexing & Sharding:');
	});

	it('unwraps inline code, so a path reads as a path', () => {
		expect(displayText('Paths: `/usr` (root), `/tmp` vs `/var`')).toBe('Paths: /usr (root), /tmp vs /var');
	});

	it('shows a wikilink as its alias, or the note name', () => {
		expect(displayText('Review [[Handbook]]')).toBe('Review Handbook');
		expect(displayText('Review [[Handbook|the handbook]]')).toBe('Review the handbook');
		expect(displayText('Review [[Handbook#Section]]')).toBe('Review Handbook');
	});

	it('shows a markdown link as its label', () => {
		expect(displayText('Read [the spec](https://example.com/a?b=c)')).toBe('Read the spec');
	});

	it('handles mixed and nested emphasis', () => {
		expect(displayText('**DNS:** A, CNAME, MX. **Crucial:** SPF, _DKIM_')).toBe('DNS: A, CNAME, MX. Crucial: SPF, DKIM');
	});

	it('collapses the whitespace that unwrapping leaves behind', () => {
		expect(displayText('  spaced   out  ')).toBe('spaced out');
	});

	it('leaves snake_case identifiers alone', () => {
		expect(displayText('Check manual_test (1) and __really bold__')).toBe('Check manual_test (1) and really bold');
	});

	it('leaves plain text exactly as it is', () => {
		expect(displayText('Walk the dog, refill the water')).toBe('Walk the dog, refill the water');
	});
});

describe('taskMinutes', () => {
	it('measures a block', () => {
		expect(taskMinutes(task({ startMin: 570, endMin: 600 }))).toBe(30);
	});
	it('treats a backwards range as crossing midnight', () => {
		expect(taskMinutes(task({ startMin: 1410, endMin: 30 }))).toBe(60);
	});
	it('is zero when unscheduled', () => {
		expect(taskMinutes(task())).toBe(0);
	});
});

describe('isOpen', () => {
	it('counts cancelled as closed', () => {
		expect(isOpen(task({ status: 'cancelled' }))).toBe(false);
		expect(isOpen(task({ status: 'done' }))).toBe(false);
		expect(isOpen(task({ status: 'blocked' }))).toBe(true);
	});
});

describe('matchKey', () => {
	it.each([
		['Work on atlas', 'work on atlas'],
		['**Work** on [[atlas]]', 'work on atlas'],
		['Work on atlas `Q1` #ws/atlas', 'work on atlas q1 wsatlas'],
		['  Spaced   out  ', 'spaced out'],
		['', '']
	])('reduces %j to %j', (text, key) => {
		expect(matchKey(text)).toBe(key);
	});

	it('leaves a card\'s key inside the block that plans it', () => {
		expect(matchKey('Finish chapter 3 [[Study/Algorithms]] `Q2`')).toContain(matchKey('Finish chapter 3'));
	});
});
