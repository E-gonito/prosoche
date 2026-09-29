import { describe, it, expect } from 'vitest';
import { newDateLine, parseDateLine, scanDates } from './dating-person';

describe('parseDateLine', () => {
	it('reads the artifact shape', () => {
		const line = parseDateLine('- 2026-09-20 Coffee at Monmouth rating:: 4 cost:: 9 notes:: easy conversation');
		expect(line).toMatchObject({
			day: '2026-09-20',
			text: 'Coffee at Monmouth',
			rating: 4,
			cost: 9,
			notes: 'easy conversation'
		});
	});

	it('defaults absent fields to null rather than zero', () => {
		const line = parseDateLine('- 2026-09-20 Coffee at Monmouth')!;
		expect(line.rating).toBeNull();
		expect(line.cost).toBeNull();
		expect(line.notes).toBe('');
	});

	it('keeps "::" inside notes as text', () => {
		const line = parseDateLine('- 2026-09-20 Drinks notes:: talked about work::life balance')!;
		expect(line.notes).toBe('talked about work::life balance');
	});

	it('is not fooled by a heading or plain prose', () => {
		expect(parseDateLine('## Dates')).toBeNull();
		expect(parseDateLine('Some prose about a date, not a log line.')).toBeNull();
	});
});

describe('scanDates', () => {
	it('reads every dates line under any heading, in file order', () => {
		const content = [
			'---',
			'type: person',
			'stage: dating',
			'---',
			'',
			'## Dates',
			'- 2026-09-10 First coffee rating:: 3',
			'- 2026-09-20 Coffee at Monmouth rating:: 4 cost:: 9 notes:: easy conversation'
		].join('\n');
		const dates = scanDates(content);
		expect(dates.map((d) => d.day)).toEqual(['2026-09-10', '2026-09-20']);
	});
});

describe('newDateLine', () => {
	it('matches the artifact shape', () => {
		expect(newDateLine('2026-09-20', 'Coffee at Monmouth', { rating: 4, cost: 9, notes: 'easy conversation' })).toBe(
			'- 2026-09-20 Coffee at Monmouth rating:: 4 cost:: 9 notes:: easy conversation'
		);
	});

	it('omits absent fields entirely', () => {
		expect(newDateLine('2026-09-20', 'Coffee at Monmouth', {})).toBe('- 2026-09-20 Coffee at Monmouth');
	});
});
