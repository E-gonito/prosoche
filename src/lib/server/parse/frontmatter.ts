/**
 * Span edits to a note's YAML frontmatter.
 *
 * Reading frontmatter is `note.ts`'s job, through gray-matter. Writing it is
 * here, and never goes back through a YAML serialiser: dumping the parsed
 * block again would reorder keys, restyle lists and drop the comments the
 * user wrote. An edit rewrites the lines of the one key it names and copies
 * every other byte of the note across.
 *
 *     ---
 *     kind: supplier            <- a one-line value: only `supplier` changes
 *     links:                    <- a list: its item lines are replaced together
 *       - https://mangtomas.ph
 *     ---
 *
 * Only top-level keys written plainly at the start of a line are found. A key
 * this cannot find is inserted rather than guessed at, so the worst a strange
 * block can do is gain a line.
 */

import matter from 'gray-matter';

/**
 * Set one top-level frontmatter key, leaving every other byte as it was.
 *
 * `value` is a string, a number or a boolean for a scalar field, or a list
 * of strings for a list field. An empty string, or a list with nothing in
 * it, clears the field: the key stays with no value (`company:`), so it
 * keeps its place in the block for the next edit.
 *
 * - An existing one-line key keeps its spacing after the colon; only the value
 *   is replaced.
 * - An existing key whose value runs over several lines (a list, a block
 *   scalar), or any key being given a list, has all of its lines replaced. A
 *   list keeps the indent its items already had, or two spaces.
 * - A missing key is inserted just before the closing `---`. Clearing a
 *   missing key changes nothing.
 * - A note with no frontmatter block, or one that never closes, gets a
 *   minimal block added at the top rather than an error.
 *
 * A value is written plain when YAML reads it back as the same string and
 * double-quoted otherwise, so `+447700900123` stays a phone number rather
 * than becoming an integer, and `2026-09-29` stays text; a number or a boolean
 * is always written plain, as what it is. Runs of whitespace,
 * newlines included, collapse to one space: a value is one line. Pure; never
 * throws.
 */
export function setFrontmatterField(content: string, key: string, value: string | number | boolean | readonly string[]): string {
	const plain = typeof value === 'number' || typeof value === 'boolean';
	const list = typeof value === 'string' || plain ? null : value.map(oneLine).filter(Boolean);
	const scalar = typeof value === 'string' ? oneLine(value) : plain ? String(value) : '';
	const clearing = list ? list.length === 0 : scalar === '';
	// The scalar as YAML text, quoted only if YAML would otherwise read it as
	// something other than this string.
	const encoded = clearing || list ? '' : plain ? scalar : yamlScalar(scalar, 'value');

	const lines = content.split('\n');
	const close = lines[0]?.replace(/\r$/, '') === '---' ? lines.findIndex((l, i) => i > 0 && l.replace(/\r$/, '') === '---') : -1;
	if (close === -1) {
		if (clearing) return content;
		return `---\n${render(key, encoded, list, '  ').join('\n')}\n---\n\n${content}`;
	}

	const eol = lines[0].endsWith('\r') ? '\r' : '';
	const keyLine = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:([ \\t]*)(.*?)(\\r?)$`);
	const at = lines.findIndex((l, i) => i > 0 && i < close && keyLine.test(l));

	if (at === -1) {
		if (clearing) return content;
		lines.splice(close, 0, ...render(key, encoded, list, '  ').map((l) => l + eol));
		return lines.join('\n');
	}

	let end = at + 1;
	while (end < close && isContinuation(lines[end])) end++;

	if (!list && end === at + 1) {
		const [, spacing, , cr] = keyLine.exec(lines[at])!;
		lines[at] = clearing ? `${key}:${cr}` : `${key}:${spacing || ' '}${encoded}${cr}`;
		return lines.join('\n');
	}

	const item = end > at + 1 ? /^([ \t]*)-/.exec(lines[at + 1]) : null;
	const indent = item ? item[1] : '  ';
	const lineEnd = lines[at].endsWith('\r') ? '\r' : '';
	lines.splice(at, end - at, ...render(key, encoded, list, indent).map((l) => l + lineEnd));
	return lines.join('\n');
}

/** A line that belongs to the key above it: indented, or a zero-indent list item. */
function isContinuation(line: string): boolean {
	return /^[ \t]+\S/.test(line) || /^-([ \t]|\r?$)/.test(line);
}

/** The lines one key occupies, before any line-ending is added. `encoded` is already YAML. */
function render(key: string, encoded: string, list: string[] | null, indent: string): string[] {
	if (list) return list.length ? [`${key}:`, ...list.map((item) => `${indent}- ${yamlScalar(item, 'item')}`)] : [`${key}:`];
	return [encoded ? `${key}: ${encoded}` : `${key}:`];
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/**
 * `text` as YAML will read it back: plain when that round-trips, otherwise
 * double-quoted. JSON's string syntax is YAML's double-quoted style, so
 * `JSON.stringify` is exactly the escaping needed.
 */
function yamlScalar(text: string, as: 'value' | 'item'): string {
	const probe = as === 'value' ? `---\nv: ${text}\n---\n` : `---\nv:\n  - ${text}\n---\n`;
	try {
		// Options, even empty ones, keep gray-matter from caching every probe.
		const data = matter(probe, {}).data as { v?: unknown };
		const read = as === 'value' ? data.v : Array.isArray(data.v) ? data.v[0] : undefined;
		if (read === text) return text;
	} catch {
		// Not valid YAML written plain; quoting fixes that.
	}
	return JSON.stringify(text);
}
