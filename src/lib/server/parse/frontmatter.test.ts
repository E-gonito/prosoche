import { describe, it, expect } from 'vitest';
import { parseNote } from './note';
import { setFrontmatterField } from './frontmatter';

const lines = (...l: string[]) => l.join('\n');

describe('setFrontmatterField', () => {
	const note = lines('---', 'type: person', 'app: Hinge', 'stage: talking', '---', '', '# Ada');

	it.each([
		['replaces only a one-line value', note, 'stage', 'dating', lines('---', 'type: person', 'app: Hinge', 'stage: dating', '---', '', '# Ada')],
		['keeps odd spacing after the colon', lines('---', 'stage:    talking', '---', ''), 'stage', 'ended', lines('---', 'stage:    ended', '---', '')],
		['fills an empty key', lines('---', 'company:', '---', ''), 'company', 'Mang Tomas Foods', lines('---', 'company: Mang Tomas Foods', '---', '')],
		['clears a value, keeping the key', lines('---', 'role: Sales', 'email: a@b.c', '---', ''), 'role', '', lines('---', 'role:', 'email: a@b.c', '---', '')],
		['inserts a missing key before the closing fence', lines('---', 'type: person', '---', '', '# Ada'), 'stage', 'matched', lines('---', 'type: person', 'stage: matched', '---', '', '# Ada')],
		['inserts into an empty block', lines('---', '---', ''), 'kind', 'lead', lines('---', 'kind: lead', '---', '')],
		['clearing a missing key changes nothing', note, 'company', '', note],
		['adds a block to a note that has none', '# Ada\n', 'stage', 'matched', '---\nstage: matched\n---\n\n# Ada\n'],
		['adds a block when the opening fence never closes', '---\ntype: person\n', 'stage', 'matched', '---\nstage: matched\n---\n\n---\ntype: person\n'],
		['clearing leaves a note with no block alone', '# Ada\n', 'stage', '', '# Ada\n'],
		['collapses whitespace to one line', lines('---', 'role: x', '---'), 'role', '  Head of\n  sales ', lines('---', 'role: Head of sales', '---')],
		['quotes a value YAML would read as a number', lines('---', 'phone:', '---'), 'phone', '+447700900123', lines('---', 'phone: "+447700900123"', '---')],
		['quotes a value YAML would read as a date', lines('---', 'x:', '---'), 'x', '2026-09-29', lines('---', 'x: "2026-09-29"', '---')],
		['quotes a value with a colon-space in it', lines('---', 'role:', '---'), 'role', 'Sales: EMEA', lines('---', 'role: "Sales: EMEA"', '---')],
		['quotes a value with a comment marker in it', lines('---', 'role:', '---'), 'role', 'a # b', lines('---', 'role: "a # b"', '---')],
		['leaves a phone with spaces plain', lines('---', 'phone:', '---'), 'phone', '+44 7700 900123', lines('---', 'phone: +44 7700 900123', '---')],
		['does not mistake a longer key for the one named', lines('---', 'company_size: 3', '---'), 'company', 'Acme', lines('---', 'company_size: 3', 'company: Acme', '---')],
		['ignores an indented key of the same name', lines('---', 'links:', '  company: nested', '---'), 'company', 'Acme', lines('---', 'links:', '  company: nested', 'company: Acme', '---')],
		['replaces a multi-line scalar with one line', lines('---', 'role: >', '  Head of', '  sales', 'email: a@b.c', '---'), 'role', 'CEO', lines('---', 'role: CEO', 'email: a@b.c', '---')],
		['keeps a CRLF note CRLF', '---\r\nstage: talking\r\n---\r\n', 'stage', 'dating', '---\r\nstage: dating\r\n---\r\n'],
		['inserts with the note’s own line ending', '---\r\ntype: person\r\n---\r\n', 'stage', 'dating', '---\r\ntype: person\r\nstage: dating\r\n---\r\n'],
		['writes a flag bare, so it reads back as a boolean', lines('---', 'name: Kaya', 'folders:', '  - Kaya', '---'), 'meetings', true, lines('---', 'name: Kaya', 'folders:', '  - Kaya', 'meetings: true', '---')],
		['rewrites an existing flag in place', lines('---', 'meetings: false', 'name: Kaya', '---'), 'meetings', true, lines('---', 'meetings: true', 'name: Kaya', '---')],
		['still quotes the string "true"', lines('---', 'x:', '---'), 'x', 'true', lines('---', 'x: "true"', '---')]
	])('%s', (_name, before, key, value, after) => {
		expect(setFrontmatterField(before, key, value)).toBe(after);
	});

	describe('lists', () => {
		const contact = lines('---', 'kind: supplier', 'links:', '  - https://a.example', '  - https://b.example', 'phone: 1', '---', '', 'Notes.');

		it.each([
			['replaces every item line', contact, ['https://c.example'], lines('---', 'kind: supplier', 'links:', '  - https://c.example', 'phone: 1', '---', '', 'Notes.')],
			['clears to a bare key', contact, [], lines('---', 'kind: supplier', 'links:', 'phone: 1', '---', '', 'Notes.')],
			['keeps zero-indent items zero-indent', lines('---', 'links:', '- a', '---'), ['a', 'b'], lines('---', 'links:', '- a', '- b', '---')],
			['turns a flow list into a block list', lines('---', 'links: [a]', 'x: 1', '---'), ['a', 'b'], lines('---', 'links:', '  - a', '  - b', 'x: 1', '---')],
			['fills a bare key', lines('---', 'links:', '---'), ['https://a.example'], lines('---', 'links:', '  - https://a.example', '---')],
			['inserts a missing list key', lines('---', 'kind: lead', '---'), ['x'], lines('---', 'kind: lead', 'links:', '  - x', '---')],
			['drops blank items', lines('---', 'links:', '---'), ['', '  ', 'a'], lines('---', 'links:', '  - a', '---')]
		])('%s', (_name, before, value, after) => {
			expect(setFrontmatterField(before, 'links', value)).toBe(after);
		});

		it('writes items YAML reads back as the same strings', () => {
			const out = setFrontmatterField(lines('---', '---', ''), 'links', ['https://x.example/a#b', 'key: value', '42']);
			expect(parseNote(out).frontmatter.links).toEqual(['https://x.example/a#b', 'key: value', '42']);
		});
	});

	it('touches no other line', () => {
		const out = setFrontmatterField(note, 'stage', 'ended');
		expect(out.split('\n').filter((_, i) => i !== 3)).toEqual(note.split('\n').filter((_, i) => i !== 3));
	});
});
