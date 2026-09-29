import { describe, it, expect } from 'vitest';
import { newLedgerLine, parseLedgerLine, rewriteLedgerLine, saveLedgerDay, scanLedger } from './ledger';

describe('parseLedgerLine', () => {
	it('reads the artifact line exactly', () => {
		const line = parseLedgerLine('- 2026-09-29 sent:: 12 matches:: 2 type:: 1 received:: 5 notes:: slow Monday');
		expect(line).toMatchObject({ day: '2026-09-29', sent: 12, matches: 2, type: 1, received: 5, notes: 'slow Monday' });
	});

	it('tolerates odd spacing, missing "::" spaces and extra whitespace', () => {
		const line = parseLedgerLine('-   2026-09-29   sent::12  matches::   2   type::0 received::  5')!;
		expect(line).toMatchObject({ sent: 12, matches: 2, type: 0, received: 5, notes: '' });
	});

	it('defaults every absent field rather than guessing', () => {
		// The real line e2e/fixtures/notes.mjs already writes, so this stays
		// compatible with it: sent and matches only, nothing else.
		const line = parseLedgerLine('- 2026-09-01 sent:: 3 matches:: 1')!;
		expect(line).toMatchObject({ day: '2026-09-01', sent: 3, matches: 1, type: 0, received: 0, notes: '' });
	});

	it('keeps a "::" inside notes as text, not as another field', () => {
		const line = parseLedgerLine('- 2026-09-10 sent:: 4 matches:: 1 notes:: talked about work::life balance')!;
		expect(line.notes).toBe('talked about work::life balance');
	});

	it('is not fooled by a heading, a blank line or prose', () => {
		expect(parseLedgerLine('# Ledger')).toBeNull();
		expect(parseLedgerLine('')).toBeNull();
		expect(parseLedgerLine('Notes for the month go here.')).toBeNull();
		expect(parseLedgerLine('- not a date sent:: 1')).toBeNull();
	});
});

describe('scanLedger', () => {
	it('finds every ledger line and skips everything else, in file order', () => {
		const content = [
			'# Ledger',
			'',
			'A stray line of prose someone left here.',
			'- 2026-09-01 sent:: 3 matches:: 1',
			'- 2026-09-03 sent:: 5 matches:: 0 type:: 0 received:: 2'
		].join('\n');
		const entries = scanLedger(content);
		expect(entries.map((e) => e.day)).toEqual(['2026-09-01', '2026-09-03']);
		expect(entries[0].line).toBe(3);
	});
});

describe('rewriteLedgerLine', () => {
	it('changes only the field asked for, keeping odd spacing on the rest', () => {
		const raw = '-   2026-09-29   sent::12  matches::   2   type::0 received::  5';
		const out = rewriteLedgerLine(raw, { sent: 20 });
		expect(out).toBe('-   2026-09-29   sent::20  matches::   2   type::0 received::  5');
	});

	it('replaces notes even when the new text contains "::"', () => {
		const raw = '- 2026-09-29 sent:: 12 matches:: 2 type:: 1 received:: 5 notes:: slow Monday';
		const out = rewriteLedgerLine(raw, { notes: 'talked about work::life balance' });
		expect(out).toBe('- 2026-09-29 sent:: 12 matches:: 2 type:: 1 received:: 5 notes:: talked about work::life balance');
	});

	it('appends a missing count field before an existing notes field', () => {
		const raw = '- 2026-09-01 sent:: 3 matches:: 1 notes:: hi';
		const out = rewriteLedgerLine(raw, { type: 1, received: 2 });
		expect(out).toBe('- 2026-09-01 sent:: 3 matches:: 1 type:: 1 received:: 2 notes:: hi');
	});

	it('appends a missing count field at the end when there is no notes field', () => {
		const raw = '- 2026-09-01 sent:: 3 matches:: 1';
		const out = rewriteLedgerLine(raw, { type: 0, received: 2 });
		expect(out).toBe('- 2026-09-01 sent:: 3 matches:: 1 type:: 0 received:: 2');
	});

	it('adds a notes field that did not exist', () => {
		const raw = '- 2026-09-01 sent:: 3 matches:: 1';
		const out = rewriteLedgerLine(raw, { notes: 'first day' });
		expect(out).toBe('- 2026-09-01 sent:: 3 matches:: 1 notes:: first day');
	});

	it('leaves an empty notes edit alone when there is nothing to remove', () => {
		const raw = '- 2026-09-01 sent:: 3 matches:: 1';
		expect(rewriteLedgerLine(raw, { notes: '' })).toBe(raw);
	});

	it('is a no-op on a line that is not a ledger line', () => {
		expect(rewriteLedgerLine('# Ledger', { sent: 1 })).toBe('# Ledger');
	});
});

describe('newLedgerLine', () => {
	it('matches the artifact shape', () => {
		expect(newLedgerLine('2026-09-29', { sent: 12, matches: 2, type: 1, received: 5 }, 'slow Monday')).toBe(
			'- 2026-09-29 sent:: 12 matches:: 2 type:: 1 received:: 5 notes:: slow Monday'
		);
	});

	it('omits notes entirely when there is none, as on a zero day', () => {
		expect(newLedgerLine('2026-09-29', { sent: 0, matches: 0, type: 0, received: 0 })).toBe(
			'- 2026-09-29 sent:: 0 matches:: 0 type:: 0 received:: 0'
		);
	});
});

describe('saveLedgerDay', () => {
	it('creates a fresh file with a heading', () => {
		const out = saveLedgerDay('', '2026-09-29', { sent: 1, matches: 0, type: 0, received: 0 });
		expect(out).toBe('# Ledger\n\n- 2026-09-29 sent:: 1 matches:: 0 type:: 0 received:: 0\n');
	});

	it('rewrites an existing day in place, leaving other lines untouched', () => {
		const content = [
			'# Ledger',
			'',
			'- 2026-09-01 sent:: 3 matches:: 1',
			'- 2026-09-02 sent:: 4 matches:: 0'
		].join('\n');
		const out = saveLedgerDay(content, '2026-09-01', { sent: 9, matches: 1, type: 0, received: 0 });
		expect(out.split('\n')).toEqual([
			'# Ledger',
			'',
			'- 2026-09-01 sent:: 9 matches:: 1 type:: 0 received:: 0',
			'- 2026-09-02 sent:: 4 matches:: 0'
		]);
	});

	it('inserts a new day in date order between two existing days', () => {
		const content = ['# Ledger', '', '- 2026-09-01 sent:: 3 matches:: 1', '- 2026-09-05 sent:: 2 matches:: 0'].join(
			'\n'
		);
		const out = saveLedgerDay(content, '2026-09-03', { sent: 1, matches: 0, type: 0, received: 0 });
		expect(out.split('\n')).toEqual([
			'# Ledger',
			'',
			'- 2026-09-01 sent:: 3 matches:: 1',
			'- 2026-09-03 sent:: 1 matches:: 0 type:: 0 received:: 0',
			'- 2026-09-05 sent:: 2 matches:: 0'
		]);
	});

	it('inserts a day earlier than every existing one at the top', () => {
		const content = ['# Ledger', '', '- 2026-09-05 sent:: 2 matches:: 0'].join('\n');
		const out = saveLedgerDay(content, '2026-09-01', { sent: 1, matches: 0, type: 0, received: 0 });
		expect(out.split('\n')).toEqual([
			'# Ledger',
			'',
			'- 2026-09-01 sent:: 1 matches:: 0 type:: 0 received:: 0',
			'- 2026-09-05 sent:: 2 matches:: 0'
		]);
	});

	it('never touches a non-ledger line', () => {
		const content = ['# Ledger', '', '<!-- a note to self -->', '- 2026-09-01 sent:: 1 matches:: 0'].join('\n');
		const out = saveLedgerDay(content, '2026-09-01', { sent: 2, matches: 0, type: 0, received: 0 });
		expect(out.split('\n')[2]).toBe('<!-- a note to self -->');
	});
});
