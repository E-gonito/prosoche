import { describe, it, expect } from 'vitest';
import { noteHref, relativeDay, stepPieces } from './links';

describe('noteHref', () => {
	it('encodes each segment and keeps the slashes', () => {
		expect(noteHref('Work Projects/eye2gene/Log.md')).toBe('/notes/Work%20Projects/eye2gene/Log.md');
	});
});

describe('relativeDay', () => {
	it.each([
		['2026-09-29', 'today'],
		['2026-09-28', 'yesterday'],
		['2026-09-30', 'tomorrow'],
		['2026-09-25', '4 days ago'],
		['2026-10-02', 'in 3 days'],
		['2026-09-01', '2026-09-01']
	])('%s reads as %s on 2026-09-29', (day, words) => {
		expect(relativeDay(day, '2026-09-29')).toBe(words);
	});
});

describe('stepPieces', () => {
	it('splits code and wikilinks out of the words and leaves the rest', () => {
		expect(stepPieces('Open [[Glossaries/Tagalog]] and run `cargo test`')).toEqual([
			{ text: 'Open ' },
			{ text: 'Tagalog', href: '/glossary/tagalog' },
			{ text: ' and run ' },
			{ text: 'cargo test', code: true }
		]);
	});

	it('shows a link’s label, opens a note by path, and ignores a heading part', () => {
		expect(stepPieces('[[Wisdom/Books/The Art of War - Sun Tzu#Ch 1|the book]]')).toEqual([
			{ text: 'the book', href: '/notes/Wisdom/Books/The%20Art%20of%20War%20-%20Sun%20Tzu.md' }
		]);
	});

	it('leaves a lone backtick or bracket as text', () => {
		expect(stepPieces('a ` b [[ c')).toEqual([{ text: 'a ` b [[ c' }]);
	});
});
