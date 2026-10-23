import { describe, it, expect } from 'vitest';
import { parseRange } from './range';

const range = (start: number, end: number) => ({ kind: 'range', start, end });

describe('parseRange', () => {
	it.each([
		['bytes=0-99', 1000, range(0, 99)],
		['bytes=500-', 1000, range(500, 999)],
		['bytes=900-5000', 1000, range(900, 999)],
		['bytes=-100', 1000, range(900, 999)],
		['bytes=-5000', 1000, range(0, 999)],
		['bytes=0-0', 1000, range(0, 0)],
		['bytes=999-999', 1000, range(999, 999)],
		['  Bytes = 10 - 20 ', 1000, range(10, 20)],
		['bytes=1000-', 1000, { kind: 'unsatisfiable' }],
		['bytes=2000-3000', 1000, { kind: 'unsatisfiable' }],
		['bytes=-0', 1000, { kind: 'unsatisfiable' }],
		['bytes=0-', 0, { kind: 'unsatisfiable' }],
		['bytes=-5', 0, { kind: 'unsatisfiable' }]
	])('%s of %i bytes', (header, size, want) => {
		expect(parseRange(header, size)).toEqual(want);
	});

	it.each([null, undefined, '', 'bytes=', 'bytes=-', 'items=0-5', 'bytes=0-5,10-15', 'bytes=9-3', 'bytes=a-b', 'bytes=99999999999999999999-'])('serves the whole file for %j', (header) => {
		expect(parseRange(header, 1000)).toEqual({ kind: 'whole' });
	});
});
