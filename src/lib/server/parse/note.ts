/**
 * Structure extracted from a markdown note: frontmatter, headings, wikilinks
 * and tags.
 *
 * Scanning ignores fenced code blocks and inline code spans, because this
 * vault keeps its task Backlog inside a fence and its notes are full of code
 * containing `#` and `[[`. Anything the scanner is unsure about is left out
 * rather than guessed at; a missed link is recoverable, a wrong one is not.
 */

import matter from 'gray-matter';

export interface Wikilink {
	/** Note name as written, without the heading or alias. */
	target: string;
	/** Text after `|`, or null. */
	alias: string | null;
	/** Text after `#`, or null. */
	heading: string | null;
	/** True for `![[...]]` embeds. */
	embed: boolean;
	line: number;
}

export interface Heading {
	level: number;
	text: string;
	line: number;
}

export interface ParsedNote {
	/** Frontmatter as a plain object; empty when the note has none. */
	frontmatter: Record<string, unknown>;
	/** Body with the frontmatter block removed. */
	body: string;
	/** Line the body starts on in the original file, so line numbers stay true. */
	bodyOffset: number;
	title: string;
	headings: Heading[];
	links: Wikilink[];
	/** Tags without the leading `#`, deduplicated, in first-seen order. */
	tags: string[];
}

const WIKILINK = /(!?)\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
const TAG = /(^|[\s(])#([A-Za-z][\w/-]*)/g;
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*$/;
const FENCE = /^[ \t]*(```|~~~)/;

/**
 * Parse a note. `path` is used only to derive a fallback title, so this stays
 * a pure function of its inputs. Malformed frontmatter yields an empty object
 * rather than throwing: a note the user is midway through editing must still
 * be readable.
 */
export function parseNote(content: string, path = ''): ParsedNote {
	let frontmatter: Record<string, unknown> = {};
	let body = content;
	let bodyOffset = 0;

	try {
		const parsed = matter(content);
		frontmatter = (parsed.data ?? {}) as Record<string, unknown>;
		body = parsed.content;
		if (Object.keys(frontmatter).length > 0 || parsed.matter) {
			bodyOffset = content.slice(0, content.length - body.length).split('\n').length - 1;
		}
	} catch {
		frontmatter = {};
		body = content;
	}

	const lines = body.split('\n');
	const headings: Heading[] = [];
	const links: Wikilink[] = [];
	const tags: string[] = [];
	const seenTags = new Set<string>();
	let fence: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const f = FENCE.exec(raw);
		if (f) {
			if (fence === null) fence = f[1];
			else if (f[1] === fence) fence = null;
			continue;
		}
		if (fence !== null) continue;

		const line = stripInlineCode(raw);
		const h = HEADING.exec(line);
		if (h) headings.push({ level: h[1].length, text: h[2], line: i + bodyOffset });

		WIKILINK.lastIndex = 0;
		for (let m = WIKILINK.exec(line); m; m = WIKILINK.exec(line)) {
			links.push({
				embed: m[1] === '!',
				target: m[2].trim(),
				heading: m[3]?.trim() ?? null,
				alias: m[4]?.trim() ?? null,
				line: i + bodyOffset
			});
		}

		for (const { tag } of scanTags(line)) {
			if (!seenTags.has(tag)) {
				seenTags.add(tag);
				tags.push(tag);
			}
		}
	}

	const fmTitle = typeof frontmatter.title === 'string' ? frontmatter.title : null;
	const firstH1 = headings.find((h) => h.level === 1)?.text;
	const title = fmTitle ?? firstH1 ?? basename(path) ?? 'Untitled';

	return { frontmatter, body, bodyOffset, title, headings, links, tags };
}

/** File name without directories or the `.md` extension. */
export function basename(path: string): string {
	const name = path.split('/').pop() ?? '';
	return name.endsWith('.md') ? name.slice(0, -3) : name;
}

/** Replace inline code spans with spaces so their contents are never scanned. */
function stripInlineCode(line: string): string {
	let out = '';
	let i = 0;
	while (i < line.length) {
		if (line[i] === '`') {
			const close = line.indexOf('`', i + 1);
			if (close === -1) {
				out += line.slice(i);
				break;
			}
			out += ' '.repeat(close - i + 1);
			i = close + 1;
		} else {
			out += line[i];
			i++;
		}
	}
	return out;
}

/**
 * Every tag in a line of text, with the character range each one occupies.
 *
 * Lives here because this is where the vault's tag syntax is defined, and a
 * tag written inside a task line is the same tag as one written in prose. The
 * ranges cover the `#` as well as the name, so a caller removing a tag can
 * excise exactly what it matched and nothing else.
 */
export function scanTags(text: string): Array<{ tag: string; start: number; end: number }> {
	const found: Array<{ tag: string; start: number; end: number }> = [];
	// Blanking code spans keeps every other character at its original offset,
	// so `#define` inside backticks is skipped without shifting the ranges.
	const scan = stripInlineCode(text);
	TAG.lastIndex = 0;
	for (let m = TAG.exec(scan); m; m = TAG.exec(scan)) {
		const start = m.index + m[1].length;
		found.push({ tag: m[2], start, end: start + 1 + m[2].length });
	}
	return found;
}
