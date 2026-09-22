import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `docs/design.md` is the page anyone reaches for before writing a style, so
 * a token it names and `src/app.css` does not define is worse than no page at
 * all: it reads as true and silently resolves to nothing wherever it is used.
 *
 * This is the one direction worth checking. A token defined in the stylesheet
 * and left out of the page is a gap in the documentation; a token promised by
 * the page and missing from the stylesheet is a broken rule in the app.
 *
 * Only fenced code blocks are read, because the prose names classes and
 * properties too, and `font-variant-numeric` is not a token.
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const css = read('./app.css');
const doc = read('../docs/design.md');

/** Every `--name` inside a fenced block, in the order the page introduces them. */
function tokensNamedIn(markdown: string): string[] {
	const found = new Set<string>();
	for (const [, block] of markdown.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
		for (const [, name] of block.matchAll(/(--[a-z0-9-]+)/g)) found.add(name);
	}
	return [...found];
}

/** Every `--name: …` declared on `:root`, which is where all of them live. */
function tokensDefinedIn(stylesheet: string): Set<string> {
	const root = /:root\s*\{([\s\S]*?)\n\}/.exec(stylesheet);
	expect(root, 'app.css defines its tokens on :root').not.toBeNull();
	return new Set([...root![1].matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

describe('the design tokens', () => {
	const named = tokensNamedIn(doc);
	const defined = tokensDefinedIn(css);

	it('are documented, which is the only reason this test can run', () => {
		// A guard on the extraction itself: an empty list would pass everything.
		expect(named.length).toBeGreaterThan(20);
	});

	it('all exist in app.css, so the page cannot promise one that does not', () => {
		const missing = named.filter((name) => !defined.has(name));
		expect(missing, `named in docs/design.md but not defined in src/app.css`).toEqual([]);
	});

	it('cover the scales the page says they cover', () => {
		for (const name of ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6']) {
			expect(named, `docs/design.md documents ${name}`).toContain(name);
		}
		for (const name of ['--t11', '--t12', '--t13', '--t14', '--t16', '--t20', '--t24']) {
			expect(named, `docs/design.md documents ${name}`).toContain(name);
		}
	});
});

describe('the design page', () => {
	it('names both breakpoints, which cannot be tokens and so cannot be checked', () => {
		expect(doc).toContain('720px');
		expect(doc).toContain('960px');
	});

	it('is short enough to be read before writing a style', () => {
		expect(doc.split('\n').length).toBeLessThan(150);
	});
});
