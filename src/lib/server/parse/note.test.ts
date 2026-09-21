import { describe, it, expect } from 'vitest';
import { parseNote } from './note';

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
