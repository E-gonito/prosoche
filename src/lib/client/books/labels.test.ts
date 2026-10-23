import { describe, expect, test } from 'vitest';
import type { ContentsEntry } from '$lib/shared/books';
import { contentsIndex, readFontScale, snippetHtml, stepFontScale } from './labels';

describe('stepFontScale', () => {
	test.each([
		[1, 1, 1.1],
		[1.1, 1, 1.2],
		[0.9, -1, 0.8],
		[0.8, -1, 0.8],
		[1.6, 1, 1.6],
		[1.5, 1, 1.6]
	] as const)('%f %i -> %f', (from, dir, want) => expect(stepFontScale(from, dir)).toBe(want));
	test('repeated steps stay on a tenth', () => {
		let s = 1;
		for (let i = 0; i < 6; i++) s = stepFontScale(s, 1);
		expect(s).toBe(1.6);
	});
});

describe('readFontScale', () => {
	test.each([
		[null, 1],
		['', 1],
		['1.3', 1.3],
		['3', 1],
		['0.1', 1],
		['abc', 1]
	])('%j -> %f', (stored, want) => expect(readFontScale(stored)).toBe(want));
});

const pdfContents: ContentsEntry[] = [
	{ title: 'Preface', place: { kind: 'page', page: 1 }, depth: 0 },
	{ title: 'One', place: { kind: 'page', page: 10 }, depth: 0 },
	{ title: 'One.1', place: { kind: 'page', page: 20 }, depth: 1 },
	{ title: 'Two', place: { kind: 'page', page: 50 }, depth: 0 }
];
const htmlContents: ContentsEntry[] = [
	{ title: 'Intro', place: { kind: 'html', chapter: 'a.html' }, depth: 0 },
	{ title: 'A, part 2', place: { kind: 'html', chapter: 'b.html', anchor: 'two' }, depth: 1 },
	{ title: 'B', place: { kind: 'html', chapter: 'b.html' }, depth: 0 }
];

describe('contentsIndex', () => {
	test.each([
		[1, 0],
		[9, 0],
		[10, 1],
		[35, 2],
		[500, 3]
	])('page %i is under line %i', (page, want) => expect(contentsIndex(pdfContents, { kind: 'page', page })).toBe(want));
	test.each([
		[{ kind: 'html', chapter: 'a.html', anchor: 'x' }, 0],
		[{ kind: 'html', chapter: 'b.html', anchor: 'two' }, 1],
		[{ kind: 'html', chapter: 'b.html', anchor: 'other' }, 1], // the chapter's first entry
		[{ kind: 'html', chapter: 'c.html' }, -1]
	] as const)('%j is under line %i', (place, want) => expect(contentsIndex(htmlContents, place)).toBe(want));
	test('no place, no contents', () => {
		expect(contentsIndex(pdfContents, null)).toBe(-1);
		expect(contentsIndex([], { kind: 'page', page: 3 })).toBe(-1);
	});
});

describe('snippetHtml', () => {
	test.each([
		['a «match» here', 'a <mark>match</mark> here'],
		['<script>alert(1)</script> «x»', '&lt;script&gt;alert(1)&lt;/script&gt; <mark>x</mark>'],
		['Tom & "Jerry\'s"', 'Tom &amp; &quot;Jerry&#39;s&quot;'],
		['', '']
	])('%j', (input, want) => expect(snippetHtml(input)).toBe(want));
});
