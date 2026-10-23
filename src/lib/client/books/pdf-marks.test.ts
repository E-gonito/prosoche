import { describe, expect, test } from 'vitest';
import { findAll, findQuote, normalizeText } from './pdf-marks';

const items = ['The quick brown fox', ' jumps over the lazy', 'dog. The Quick  brown', 'fox again.'];

describe('normalizeText', () => {
	test.each([
		['  Hello,   World ', 'hello, world'],
		['soft­hyphen', 'softhyphen'],
		['line\nbreak\tand', 'line break and'],
		['', '']
	])('%j', (input, want) => expect(normalizeText(input)).toBe(want));
});

describe('findAll', () => {
	test('every occurrence, ignoring case and spacing, in item positions', () => {
		expect(findAll(items, 'quick brown')).toEqual([
			{ start: { item: 0, offset: 4 }, end: { item: 0, offset: 15 } },
			{ start: { item: 2, offset: 9 }, end: { item: 2, offset: 21 } }
		]);
	});
	test('across items', () => {
		expect(findAll(items, 'lazy dog')).toEqual([{ start: { item: 1, offset: 16 }, end: { item: 2, offset: 3 } }]);
	});
	test('a needle spanning an item break and an extra space', () => {
		const m = findAll(items, 'brown fox again');
		expect(m).toHaveLength(1);
		expect(m[0].start).toEqual({ item: 2, offset: 16 });
		expect(m[0].end).toEqual({ item: 3, offset: 9 });
	});
	test.each(['', '   ', 'cat'])('nothing for %j', (needle) => expect(findAll(items, needle)).toEqual([]));
	test('limit', () => expect(findAll(['a a a a a'], 'a', 2)).toHaveLength(2));
});

describe('findQuote', () => {
	test('the whole quote', () => {
		expect(findQuote(items, 'over the lazy dog')).toEqual({ start: { item: 1, offset: 7 }, end: { item: 2, offset: 3 } });
	});
	test('a long quote with a changed middle is found by its ends', () => {
		const page = ['one two three four five six SEVEN eight nine ten eleven twelve thirteen', 'fourteen fifteen sixteen'];
		const quote = 'one two three four five six XXXX nine ten eleven twelve thirteen fourteen fifteen sixteen';
		const m = findQuote(page, quote);
		expect(m?.start).toEqual({ item: 0, offset: 0 });
		expect(m?.end).toEqual({ item: 1, offset: 24 });
	});
	test('a long quote whose end is missing is found by its start', () => {
		const page = ['one two three four five six seven eight nine ten eleven twelve'];
		const m = findQuote(page, 'one two three four five six seven eight nine ten eleven twelve zzz yyy xxx');
		expect(m?.start).toEqual({ item: 0, offset: 0 });
		expect(m?.end.offset).toBeLessThanOrEqual(page[0].length);
	});
	test.each(['', 'not on this page', 'a short quote that is not here'])('null for %j', (q) => expect(findQuote(items, q)).toBeNull());
});
