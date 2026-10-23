import { describe, it, expect } from 'vitest';
import { addHighlight, cleanQuote, MAX_QUOTE, newBookNote, readBookNote, setPlace } from './note';
import { parsePlace, type Place } from '$lib/shared/books';

const ID = '0123456789abcdef';
const page = (n: number): Place => ({ kind: 'page', page: n });

const FULL = `---
book: ${ID}
format: pdf
source: "CS:APP.pdf"
added: 2026-10-23
at: p. 412
read_at: 2026-10-23
---

## Highlights

- > the quoted words — p. 412
\t- the author's comment
- > second — with a dash — p. 7
- not a highlight
- > no place here
- > bad place — nowhere at all

## Notes

- > not under highlights — p. 3
`;

describe('newBookNote', () => {
	it('is frontmatter only, with no place until the first read', () => {
		const text = newBookNote({ id: ID, format: 'pdf', source: 'CS:APP.pdf', added: '2026-10-23' });
		expect(text).toBe(`---\nbook: ${ID}\nformat: pdf\nsource: CS:APP.pdf\nadded: "2026-10-23"\n---\n\n`);
		expect(readBookNote(text)).toEqual({ id: ID, format: 'pdf', source: 'CS:APP.pdf', at: null, readAt: null, highlights: [] });
	});

	it('quotes a URL source and reads it back', () => {
		const text = newBookNote({ id: 's-0123456789abcd', format: 'site', source: 'https://example.org/book/', added: '2026-10-23' });
		expect(readBookNote(text)?.source).toBe('https://example.org/book/');
	});
});

describe('readBookNote', () => {
	it('reads the fields and the highlights under ## Highlights only', () => {
		const note = readBookNote(FULL)!;
		expect(note).toMatchObject({ id: ID, format: 'pdf', source: 'CS:APP.pdf', at: page(412), readAt: '2026-10-23' });
		expect(note.highlights).toEqual([
			{ quote: 'the quoted words', place: page(412), comment: "the author's comment", line: 11 },
			{ quote: 'second — with a dash', place: page(7), line: 13 }
		]);
	});

	it('reads an HTML place with an anchor', () => {
		const text = `---\nbook: s-0123456789abcd\nformat: site\nat: ch04.html#the-rules\n---\n\n## Highlights\n\n- > x — ch04.html#the-rules\n`;
		expect(readBookNote(text)).toMatchObject({ at: { kind: 'html', chapter: 'ch04.html', anchor: 'the-rules' }, highlights: [{ line: 8 }] });
	});

	it('keeps an id of only digits as text', () => {
		expect(readBookNote(`---\nbook: 1234567890123456\nformat: epub\n---\n`)?.id).toBe('1234567890123456');
	});

	it.each([
		['no frontmatter', '## Highlights\n'],
		['no book field', '---\nformat: pdf\n---\n'],
		['an invalid id', '---\nbook: nope\nformat: pdf\n---\n'],
		['an unknown format', `---\nbook: ${ID}\nformat: mobi\n---\n`],
		['no format', `---\nbook: ${ID}\n---\n`],
		['empty', '']
	])('is null for %s', (_n, text) => {
		expect(readBookNote(text)).toBeNull();
	});

	it('reads a place it cannot parse as none', () => {
		expect(readBookNote(`---\nbook: ${ID}\nformat: pdf\nat: ../etc\n---\n`)?.at).toBeNull();
	});

	it('reads a note with Windows line endings', () => {
		const text = `---\r\nbook: ${ID}\r\nformat: pdf\r\nat: p. 3\r\n---\r\n\r\n## Highlights\r\n\r\n- > q — p. 3\r\n\t- c\r\n`;
		expect(readBookNote(text)).toMatchObject({ at: page(3), highlights: [{ quote: 'q', comment: 'c', line: 8 }] });
	});

	it('stops the section at a level 1 or 2 heading but not a deeper one', () => {
		const text = `---\nbook: ${ID}\nformat: pdf\n---\n## Highlights\n### Part\n- > a — p. 1\n# Other\n- > b — p. 2\n`;
		expect(readBookNote(text)?.highlights.map((h) => h.quote)).toEqual(['a']);
	});
});

describe('setPlace', () => {
	it('adds at: and read_at: to a new note', () => {
		const text = setPlace(newBookNote({ id: ID, format: 'pdf', source: 'a.pdf', added: '2026-10-22' }), page(412), '2026-10-23');
		expect(text).toBe(`---\nbook: ${ID}\nformat: pdf\nsource: a.pdf\nadded: "2026-10-22"\nat: p. 412\nread_at: "2026-10-23"\n---\n\n`);
		expect(readBookNote(text)).toMatchObject({ at: page(412), readAt: '2026-10-23' });
	});

	it('changes only those two lines of a note that has them, whatever else is in it', () => {
		const body = `${FULL}\nmy own prose\t \n`;
		const next = setPlace(body, { kind: 'html', chapter: 'a/b.html', anchor: 'x' }, '2026-11-01');
		const was = body.split('\n');
		const now = next.split('\n');
		expect(now).toHaveLength(was.length);
		const changed = now.map((l, i) => (l === was[i] ? null : l)).filter((l) => l !== null);
		expect(changed).toEqual(['at: a/b.html#x', 'read_at: "2026-11-01"']);
	});

	it('is unchanged by setting the same place and day again', () => {
		const once = setPlace(FULL, page(5), '2026-10-24');
		expect(setPlace(once, page(5), '2026-10-24')).toBe(once);
	});
});

describe('cleanQuote', () => {
	it.each([
		['  two\n\nlines\tand   gaps ', 'two lines and gaps'],
		['', ''],
		[' \n\t ', '']
	])('collapses %j', (raw, want) => {
		expect(cleanQuote(raw)).toBe(want);
	});

	it('caps a long quote at the limit with an ellipsis', () => {
		const q = cleanQuote('word '.repeat(500));
		expect(q.length).toBeLessThanOrEqual(MAX_QUOTE);
		expect(q.endsWith('…')).toBe(true);
		expect(cleanQuote('a'.repeat(MAX_QUOTE))).toBe('a'.repeat(MAX_QUOTE));
	});
});

describe('addHighlight', () => {
	const head = `---\nbook: ${ID}\nformat: pdf\n---\n\n`;

	it.each([
		['creates the heading after one blank line', `${head}Some prose.`, `${head}Some prose.\n\n## Highlights\n\n- > q — p. 9\n`],
		['replaces extra trailing blank lines with one', `${head}Some prose.\n\n\n\n`, `${head}Some prose.\n\n## Highlights\n\n- > q — p. 9\n`],
		['makes the heading in a note with only frontmatter', head, `${head.replace(/\n+$/, '')}\n\n## Highlights\n\n- > q — p. 9\n`],
		['makes the heading in an empty note', '', '## Highlights\n\n- > q — p. 9\n'],
		['fills an empty section', `${head}## Highlights\n`, `${head}## Highlights\n\n- > q — p. 9\n`],
		['fills an empty section with a blank line already', `${head}## Highlights\n\n## Notes\n`, `${head}## Highlights\n\n- > q — p. 9\n## Notes\n`],
		['fills a section with no trailing newline', `${head}## Highlights`, `${head}## Highlights\n\n- > q — p. 9`],
		['appends after the last item, before the next heading', `${head}## Highlights\n\n- > a — p. 1\n\n## Notes\n\nx\n`, `${head}## Highlights\n\n- > a — p. 1\n- > q — p. 9\n\n## Notes\n\nx\n`],
		['appends after a comment', `${head}## Highlights\n\n- > a — p. 1\n\t- why\n`, `${head}## Highlights\n\n- > a — p. 1\n\t- why\n- > q — p. 9\n`]
	])('%s', (_name, before, after) => {
		expect(addHighlight(before, { quote: 'q', place: page(9) })).toBe(after);
	});

	it('writes a comment on the next line, tab-indented, on one line', () => {
		const next = addHighlight('', { quote: 'the  quote\nwrapped', place: page(412), comment: ' a\nb  c ' });
		expect(next).toBe('## Highlights\n\n- > the quote wrapped — p. 412\n\t- a b c\n');
		expect(readBookNote(`---\nbook: ${ID}\nformat: pdf\n---\n${next}`)?.highlights).toEqual([
			{ quote: 'the quote wrapped', place: page(412), comment: 'a b c', line: 6 }
		]);
	});

	it('writes an HTML place and reads it back', () => {
		const place = parsePlace('ch1.html#a')!;
		const next = addHighlight(`---\nbook: s-0123456789abcd\nformat: site\n---\n`, { quote: 'x — y', place });
		expect(readBookNote(next)?.highlights).toMatchObject([{ quote: 'x — y', place }]);
	});

	it('changes nothing else in a note', () => {
		const next = addHighlight(FULL, { quote: 'new', place: page(1) });
		const was = FULL.split('\n');
		const now = next.split('\n');
		expect(now).toHaveLength(was.length + 1);
		expect(now.filter((l) => !was.includes(l))).toEqual(['- > new — p. 1']);
		expect(readBookNote(next)?.highlights.at(-1)).toMatchObject({ quote: 'new', line: 17 });
	});

	it('adds nothing for a quote with no words', () => {
		expect(addHighlight(FULL, { quote: ' \n ', place: page(1) })).toBe(FULL);
	});

	it('keeps Windows line endings', () => {
		const before = `---\r\nbook: ${ID}\r\nformat: pdf\r\n---\r\n\r\n## Highlights\r\n\r\n- > a — p. 1\r\n`;
		const next = addHighlight(before, { quote: 'b', place: page(2), comment: 'c' });
		expect(next).toBe(`${before}- > b — p. 2\r\n\t- c\r\n`);
		expect(addHighlight(before.replace('## Highlights\r\n\r\n- > a — p. 1\r\n', 'text'), { quote: 'b', place: page(2) })).toContain('text\r\n\r\n## Highlights\r\n\r\n- > b — p. 2\r\n');
	});
});
