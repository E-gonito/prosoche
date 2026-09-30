import { describe, it, expect } from 'vitest';
import { parseNote, readLede, setLede } from './note';

describe('parseNote', () => {
	it('reads frontmatter and keeps the body separate', () => {
		const n = parseNote('---\ntype: person\norg: Acme\n---\n\nBody text\n');
		expect(n.frontmatter).toMatchObject({ type: 'person', org: 'Acme' });
		expect(n.body.trim()).toBe('Body text');
	});

	it('survives malformed frontmatter instead of throwing', () => {
		const n = parseNote('---\nthis: [is: not: yaml\n---\nBody\n');
		expect(n.frontmatter).toEqual({});
		expect(n.body).toContain('Body');
	});

	it('finds wikilinks with aliases, headings and embeds', () => {
		const n = parseNote('See [[Handbook]] and [[Policy 19 - Design Control|design control]].\n![[diagram.png]]\n[[React#Hooks]]');
		expect(n.links.map((l) => l.target)).toEqual(['Handbook', 'Policy 19 - Design Control', 'diagram.png', 'React']);
		expect(n.links[1].alias).toBe('design control');
		expect(n.links[2].embed).toBe(true);
		expect(n.links[3].heading).toBe('Hooks');
	});

	it('ignores links and tags inside fenced code', () => {
		const n = parseNote(['Real [[Link]] #real', '```', '[[NotALink]] #nottag', '```'].join('\n'));
		expect(n.links.map((l) => l.target)).toEqual(['Link']);
		expect(n.tags).toEqual(['real']);
	});

	it('ignores a hash inside an inline code span or a URL', () => {
		const n = parseNote('Use `#define` here, see https://example.com/page#frag and #Video');
		expect(n.tags).toEqual(['Video']);
	});

	it('takes the title from the first heading when frontmatter has none', () => {
		expect(parseNote('# Binary Arithmetic\n\ntext').title).toBe('Binary Arithmetic');
		expect(parseNote('text only', 'Computer Science/Rust.md').title).toBe('Rust');
	});

	it('reports heading lines relative to the whole file, not the body', () => {
		const n = parseNote('---\na: 1\n---\n# Title\n## Second\n');
		expect(n.headings.map((h) => [h.text, h.line])).toEqual([
			['Title', 3],
			['Second', 4]
		]);
	});
});

describe('readLede', () => {
	it.each([
		['the first paragraph after the frontmatter', '---\nname: x\n---\n\nOne line\nand the next.\n\nSecond.\n', 'One line and the next.'],
		['past a heading', '# Title\n\nThe lede.\n', 'The lede.'],
		['none when the body opens on a list', '---\na: 1\n---\n\n- item\n\nLater prose.\n', ''],
		['none in a note that is only frontmatter', '---\na: 1\n---\n', ''],
		['a note with no frontmatter', 'Just prose.', 'Just prose.']
	])('%s', (_, content, lede) => {
		expect(readLede(content)).toBe(lede);
	});
});

describe('setLede', () => {
	it.each([
		['replaces the paragraph, keeping the rest', '---\na: 1\n---\n\nOld one\nwrapped.\n\nKept.\n', 'New', '---\na: 1\n---\n\nNew\n\nKept.\n'],
		['collapses the text to one line', '---\na: 1\n---\n\nOld\n', 'Two\n  lines', '---\na: 1\n---\n\nTwo lines\n'],
		['adds one after bare frontmatter', '---\na: 1\n---\n', 'New', '---\na: 1\n---\n\nNew\n'],
		['adds one before a list', '---\na: 1\n---\n\n- item\n', 'New', '---\na: 1\n---\n\nNew\n\n- item\n'],
		['adds one set off from a heading right under the frontmatter', '---\na: 1\n---\n# H\n', 'New', '---\na: 1\n---\n\nNew\n\n# H\n'],
		['removes it with the blank line after', '---\na: 1\n---\n\nOld\n\nKept.\n', '', '---\na: 1\n---\n\nKept.\n'],
		['removes a last paragraph with the blank line before', '---\na: 1\n---\n\nOld\n', '', '---\na: 1\n---\n'],
		['keeps CRLF line endings', '---\r\na: 1\r\n---\r\n\r\nOld\r\n', 'New', '---\r\na: 1\r\n---\r\n\r\nNew\r\n'],
		['changes nothing when it already reads the same', '---\na: 1\n---\n\nSame\ntext\n', 'Same text', '---\na: 1\n---\n\nSame\ntext\n']
	])('%s', (_, content, text, expected) => {
		expect(setLede(content, text)).toBe(expected);
	});
});
