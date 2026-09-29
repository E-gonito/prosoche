import { describe, it, expect } from 'vitest';
import { addHistoryEntry, contactName, newContact, parseContact, setContactField } from './contact';

const lines = (...l: string[]) => l.join('\n');

/** The spec's own example, byte for byte. */
const SPEC = lines(
	'---',
	'kind: supplier',
	'company: Mang Tomas Foods',
	'role: Sales',
	'email: orders@mangtomas.ph',
	'phone: +44 7700 900123',
	'links:',
	'  - https://mangtomas.ph',
	'---',
	'',
	'Pork and chicken supplier. Met at the trade fair.',
	'',
	'## History',
	'- 2026-09-29 Asked for a wholesale price list',
	'- 2026-09-22 First call',
	''
);

describe('contactName', () => {
	it.each([
		['Mang Tomas Foods', 'Mang Tomas Foods'],
		['  Ada   Lovelace ', 'Ada Lovelace'],
		['Print Co.md', 'Print Co'],
		['José & Sons (UK) Ltd', 'José & Sons (UK) Ltd'],
		['', null],
		['   ', null],
		['../escape', null],
		['a/b', null],
		['a\\b', null],
		['Sales: EMEA', null],
		['Q&A #1', null],
		['[[Link]]', null],
		['what?', null],
		['.hidden', null],
		['Acme Inc.', null],
		['x'.repeat(121), null]
	])('%j -> %j', (raw, expected) => {
		expect(contactName(raw)).toBe(expected);
	});
});

describe('parseContact', () => {
	it('reads the spec example', () => {
		expect(parseContact(SPEC)).toEqual({
			kind: 'supplier',
			company: 'Mang Tomas Foods',
			role: 'Sales',
			email: 'orders@mangtomas.ph',
			phone: '+44 7700 900123',
			links: ['https://mangtomas.ph'],
			notes: 'Pork and chicken supplier. Met at the trade fair.',
			history: [
				{ line: 13, day: '2026-09-29', text: 'Asked for a wholesale price list' },
				{ line: 14, day: '2026-09-22', text: 'First call' }
			]
		});
	});

	it.each([
		['an empty note', '', { kind: null, links: [], notes: '', history: [] }],
		['bare keys', lines('---', 'kind:', 'company:', 'links:', '---', ''), { kind: null, company: null, links: [] }],
		['a kind the form does not offer', lines('---', 'kind: investor', '---'), { kind: 'investor' }],
		['a phone YAML read as a number', lines('---', 'phone: 447700900123', '---'), { phone: '447700900123' }],
		['a single link written as a string', lines('---', 'links: https://a.example', '---'), { links: ['https://a.example'] }],
		['malformed frontmatter', lines('---', 'kind: [unclosed', '---', 'Body'), { kind: null }],
		['no history heading', lines('---', 'kind: lead', '---', '', 'Just notes.'), { notes: 'Just notes.', history: [] }]
	])('reads %s', (_name, content, expected) => {
		expect(parseContact(content)).toMatchObject(expected);
	});

	it('keeps an undated bullet as history with no day, and skips prose', () => {
		const note = lines('## History', '- 2026-09-01 Called', 'a sentence', '- met again, date unknown', '- 2026-09-02');
		expect(parseContact(note).history).toEqual([
			{ line: 1, day: '2026-09-01', text: 'Called' },
			{ line: 3, day: null, text: 'met again, date unknown' },
			{ line: 4, day: '2026-09-02', text: '' }
		]);
	});

	it('keeps the notes on both sides of the history section', () => {
		const note = lines('---', 'kind: lead', '---', 'Before.', '', '## History', '- 2026-09-01 Called', '', '## Pricing', 'After.');
		const parsed = parseContact(note);
		expect(parsed.notes).toBe(lines('Before.', '', '## Pricing', 'After.'));
		expect(parsed.history).toHaveLength(1);
	});

	it('is not fooled by a History heading inside a code fence', () => {
		const note = lines('```', '## History', '- 2026-01-01 not real', '```', '## History', '- 2026-09-01 real');
		expect(parseContact(note).history).toEqual([{ line: 5, day: '2026-09-01', text: 'real' }]);
	});
});

describe('newContact', () => {
	it('writes the spec example from its details', () => {
		const made = newContact({
			kind: 'supplier',
			company: 'Mang Tomas Foods',
			role: 'Sales',
			email: 'orders@mangtomas.ph',
			phone: '+44 7700 900123',
			links: ['https://mangtomas.ph'],
			notes: 'Pork and chicken supplier. Met at the trade fair.'
		});
		const [head] = SPEC.split('\n- 2026-09-29');
		expect(made).toBe(`${head}\n`);
	});

	it('writes every key, empty ones bare, and an empty history', () => {
		expect(newContact({ kind: 'lead' })).toBe(
			lines('---', 'kind: lead', 'company:', 'role:', 'email:', 'phone:', 'links:', '---', '', '## History', '')
		);
	});

	it('quotes what YAML would misread', () => {
		expect(newContact({ phone: '+447700900123' })).toContain('phone: "+447700900123"\n');
	});

	it('reads back as what it was given', () => {
		const made = newContact({ kind: 'stakeholder', company: 'NHS: Moorfields', links: ['https://a.example', 'https://b.example'], notes: 'Notes.' });
		expect(parseContact(made)).toMatchObject({ kind: 'stakeholder', company: 'NHS: Moorfields', links: ['https://a.example', 'https://b.example'], notes: 'Notes.', history: [] });
	});
});

describe('setContactField', () => {
	it.each([
		['kind', 'lead', 'kind: lead'],
		['company', '', 'company:'],
		['phone', '+447700900123', 'phone: "+447700900123"']
	] as const)('sets %s by rewriting its line alone', (field, value, expected) => {
		const out = setContactField(SPEC, field, value);
		const before = SPEC.split('\n');
		const after = out.split('\n');
		const at = before.findIndex((l) => l.startsWith(`${field}:`));
		expect(after[at]).toBe(expected);
		expect(after.filter((_, i) => i !== at)).toEqual(before.filter((_, i) => i !== at));
	});

	it('replaces the links list, splitting a string on whitespace and dropping repeats', () => {
		const out = setContactField(SPEC, 'links', 'https://a.example\nhttps://b.example https://a.example');
		expect(out).toBe(SPEC.replace('  - https://mangtomas.ph', '  - https://a.example\n  - https://b.example'));
	});

	it('clears the links list to a bare key', () => {
		expect(setContactField(SPEC, 'links', [])).toBe(SPEC.replace('links:\n  - https://mangtomas.ph', 'links:'));
	});

	it('inserts a field a hand-written note lacks', () => {
		expect(setContactField(lines('---', 'kind: lead', '---', ''), 'email', 'a@b.c')).toBe(lines('---', 'kind: lead', 'email: a@b.c', '---', ''));
	});
});

describe('addHistoryEntry', () => {
	it('puts today’s entry on top of a newest-first history', () => {
		const out = addHistoryEntry(SPEC, '2026-09-30', '  Sent the  order ')!;
		expect(out.content).toBe(SPEC.replace('## History\n', '## History\n- 2026-09-30 Sent the order\n'));
		expect(out.line).toBe(13);
	});

	it('files a back-dated entry in date order', () => {
		const out = addHistoryEntry(SPEC, '2026-09-25', 'Tasting')!;
		expect(out.content).toBe(SPEC.replace('- 2026-09-22 First call', '- 2026-09-25 Tasting\n- 2026-09-22 First call'));
	});

	it('creates the heading at the end when there is none', () => {
		const out = addHistoryEntry(lines('---', 'kind: lead', '---', '', 'Notes.', ''), '2026-09-29', 'First call')!;
		expect(out.content).toBe(lines('---', 'kind: lead', '---', '', 'Notes.', '', '## History', '- 2026-09-29 First call', ''));
	});

	it('refuses an entry with no words', () => {
		expect(addHistoryEntry(SPEC, '2026-09-29', '   ')).toBeNull();
	});
});
