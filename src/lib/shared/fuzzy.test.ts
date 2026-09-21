import { describe, it, expect } from 'vitest';
import { fuzzyMatch, fuzzyParts, fuzzySort } from './fuzzy';

const score = (query: string, text: string) => fuzzyMatch(query, text)?.score ?? null;
const rank = (query: string, texts: string[]) => fuzzySort(query, texts, (t) => t).map((r) => r.item);

describe('fuzzyMatch', () => {
	it('matches characters in order, ignoring case', () => {
		expect(fuzzyMatch('nt', 'Note')?.positions).toEqual([0, 2]);
		expect(fuzzyMatch('NOTE', 'note')).not.toBe(null);
	});

	it('is not a match when a character is missing or out of order', () => {
		expect(fuzzyMatch('nx', 'Note')).toBe(null);
		expect(fuzzyMatch('en', 'Note')).toBe(null);
	});

	it('matches everything on an empty query, with nothing highlighted', () => {
		expect(fuzzyMatch('   ', 'anything')).toEqual({ score: 0, positions: [] });
	});

	it('scores an exact name above one that merely starts with it', () => {
		expect(score('today', 'today')!).toBeGreaterThan(score('today', "today's plan")!);
	});

	it('scores a prefix above a match in the middle', () => {
		expect(score('note', 'Notes')!).toBeGreaterThan(score('note', 'Release notes')!);
	});

	it('scores initials, so `wan` finds a path three words deep', () => {
		const folder = score('wan', 'Work/Atlas/Notes')!;
		expect(folder).toBeGreaterThan(score('wan', 'a word and a note somewhere in a sentence')!);
	});

	it('treats a capital inside a word as the start of one', () => {
		expect(score('th', 'TaskHeader')!).toBeGreaterThan(score('th', 'a t and an h')!);
	});

	it('scores a run of characters above the same ones scattered', () => {
		expect(score('cap', 'capture')!).toBeGreaterThan(score('cap', 'c a p')!);
	});

	it('prefers a hit near the front of a line of the same length', () => {
		expect(score('x', 'x-------------------------')!).toBeGreaterThan(score('x', '-------------------------x')!);
	});
});

describe('fuzzySort', () => {
	it('puts the best match first and drops the misses', () => {
		// `Toggle sidebar` really does contain t, o and d in order, so it stays
		// in the list; what matters is that the word itself outranks it.
		expect(rank('tod', ['Notes', 'Toggle sidebar', 'Go to Today', 'Today'])).toEqual(['Today', 'Go to Today', 'Toggle sidebar']);
	});

	it('breaks a tie on the shorter text', () => {
		expect(rank('ws', ['ws work', 'ws'])).toEqual(['ws', 'ws work']);
	});

	it('is stable, so an order the caller already chose survives', () => {
		// Same length and the same shape of match, so only the input order can
		// separate them.
		const recent = ['Beta notes', 'Blue notes', 'Cyan notes'];
		expect(rank('notes', recent)).toEqual(recent);
	});

	it('keeps everything, in the given order, for an empty query', () => {
		expect(rank('', ['b', 'a', 'c'])).toEqual(['b', 'a', 'c']);
	});

	it('reads the text through the accessor, so callers can rank objects', () => {
		const commands = [{ title: 'Rebuild index' }, { title: 'New note' }];
		expect(fuzzySort('new', commands, (c) => c.title).map((r) => r.item.title)).toEqual(['New note']);
	});
});

describe('fuzzyParts', () => {
	it('splits into runs so a component can highlight without building HTML', () => {
		expect(fuzzyParts('Today', [0, 2])).toEqual([
			{ text: 'T', hit: true },
			{ text: 'o', hit: false },
			{ text: 'd', hit: true },
			{ text: 'ay', hit: false }
		]);
	});

	it('returns the whole text as one run when nothing matched', () => {
		expect(fuzzyParts('Today', [])).toEqual([{ text: 'Today', hit: false }]);
	});

	it('joins adjacent matches into one run', () => {
		expect(fuzzyParts('Today', [0, 1, 2])).toEqual([
			{ text: 'Tod', hit: true },
			{ text: 'ay', hit: false }
		]);
	});
});
