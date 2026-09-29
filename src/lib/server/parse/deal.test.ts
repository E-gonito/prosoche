import { describe, it, expect } from 'vitest';
import { parseDealLine, rewriteDealField, scanDeals } from './deal';

describe('parseDealLine', () => {
	it('reads the name, the person, and every field', () => {
		const deal = parseDealLine('- Moorfields pilot [[Jane Doe]] stage:: proposal value:: 12000 next:: 2026-10-03');
		expect(deal).toMatchObject({
			text: 'Moorfields pilot [[Jane Doe]]',
			person: 'Jane Doe',
			stage: 'proposal',
			value: 12000,
			next: '2026-10-03'
		});
		expect(deal!.fields.map((f) => f.key)).toEqual(['stage', 'value', 'next']);
	});

	it('is fine with odd spacing between and inside fields', () => {
		const deal = parseDealLine('-   Odd spacing [[Someone]]   stage::   lead    value::12000   next::2026-10-03');
		expect(deal).toMatchObject({ stage: 'lead', value: 12000, next: '2026-10-03' });
	});

	it('trims trailing whitespace from the last field', () => {
		const deal = parseDealLine('- Trailing space stage:: won   ');
		expect(deal!.stage).toBe('won');
	});

	it('handles a deal with a missing field: absent, not empty', () => {
		const deal = parseDealLine('- No value yet [[Someone]] stage:: lead');
		expect(deal!.stage).toBe('lead');
		expect(deal!.value).toBeNull();
		expect(deal!.next).toBeNull();
	});

	it('is a deal with no fields at all: just a name', () => {
		const deal = parseDealLine('- Just a name, nothing filled in');
		expect(deal).not.toBeNull();
		expect(deal!.stage).toBeNull();
		expect(deal!.person).toBeNull();
	});

	it('keeps an unrecognised field verbatim', () => {
		const deal = parseDealLine('- Custom [[Someone]] stage:: lead source:: referral');
		expect(deal!.fields.find((f) => f.key === 'source')?.value).toBe('referral');
	});

	it('is null for a task line, which belongs to parse/task.ts instead', () => {
		expect(parseDealLine('- [ ] Follow up with Jane')).toBeNull();
		expect(parseDealLine('- [x] Done deal')).toBeNull();
	});

	it('is null for a line that is not a bullet at all', () => {
		expect(parseDealLine('## Deals')).toBeNull();
		expect(parseDealLine('Just some prose.')).toBeNull();
		expect(parseDealLine('')).toBeNull();
	});
});

describe('scanDeals', () => {
	it('finds every deal in a note, skipping the heading and blank lines', () => {
		const content = [
			'# Deals',
			'',
			'- Moorfields pilot [[Jane Doe]] stage:: proposal',
			'',
			'- [ ] Not a deal, a task',
			'- Second deal [[John Roe]] stage:: won'
		].join('\n');
		const deals = scanDeals(content);
		expect(deals.map((d) => d.line)).toEqual([2, 5]);
		expect(deals.map((d) => d.stage)).toEqual(['proposal', 'won']);
	});
});

describe('rewriteDealField', () => {
	it('replaces an existing value and leaves every other field untouched', () => {
		const raw = '- Moorfields pilot [[Jane Doe]] stage:: proposal value:: 12000 next:: 2026-10-03';
		const next = rewriteDealField(raw, 'stage', 'negotiation');
		expect(next).toBe('- Moorfields pilot [[Jane Doe]] stage:: negotiation value:: 12000 next:: 2026-10-03');
	});

	it('appends a field that is not there yet', () => {
		const raw = '- New deal [[Someone]] stage:: lead';
		const next = rewriteDealField(raw, 'value', '5000');
		expect(next).toBe('- New deal [[Someone]] stage:: lead value:: 5000');
	});

	it('removes a field, and the space in front of it, when given null', () => {
		const raw = '- Deal [[Someone]] stage:: lead value:: 5000 next:: 2026-10-03';
		const next = rewriteDealField(raw, 'value', null);
		expect(next).toBe('- Deal [[Someone]] stage:: lead next:: 2026-10-03');
	});

	it('preserves odd spacing around the field it does not touch', () => {
		const raw = '- Deal   stage::   lead    value:: 5000';
		const next = rewriteDealField(raw, 'stage', 'won');
		expect(next).toBe('- Deal   stage::   won    value:: 5000');
	});

	it('returns the line unchanged for a line that is not a deal', () => {
		const raw = '- [ ] Just a task';
		expect(rewriteDealField(raw, 'stage', 'won')).toBe(raw);
	});

	it('is idempotent: rewriting to the same trimmed value changes only that value', () => {
		const raw = '- Deal stage:: lead';
		expect(rewriteDealField(raw, 'stage', 'lead')).toBe(raw);
	});
});
