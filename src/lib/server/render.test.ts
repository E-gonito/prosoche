import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './render';

const resolve = (t: string) => (t === 'Handbook' ? '/notes/Work/Handbook.md' : null);

describe('renderMarkdown', () => {
	it('turns a resolved wikilink into a link', () => {
		expect(renderMarkdown('See [[Handbook]] today', resolve)).toContain(
			'<a href="/notes/Work/Handbook.md">Handbook</a>'
		);
	});

	it('marks an unresolved wikilink rather than dropping it', () => {
		const html = renderMarkdown('See [[Nowhere]]', resolve);
		expect(html).toContain('wl-missing');
		expect(html).toContain('Nowhere');
	});

	it('uses the alias when there is one', () => {
		expect(renderMarkdown('[[Handbook|the handbook]]', resolve)).toContain('>the handbook</a>');
	});

	it('renders task checkboxes', () => {
		const html = renderMarkdown('- [x] Done thing\n- [ ] Open thing');
		expect(html).toContain('type="checkbox"');
		expect(html).toContain('checked');
	});

	it('keeps the backticked quadrant as inline code', () => {
		expect(renderMarkdown('- [ ] Walk the dog `Q1`')).toContain('<code>Q1</code>');
	});

	it('leaves fenced code alone', () => {
		const html = renderMarkdown('```\n- [ ] Driving licence `Q2`\n```');
		expect(html).toContain('<pre>');
		expect(html).toContain('Driving licence');
	});
});
