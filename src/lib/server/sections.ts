/**
 * Adding a line to a named section of a markdown note.
 *
 * Three features need the same thing — quick capture files a thought under
 * today's date, the timer files a stretch of work under `## Time log`, a
 * contact is filed under a person's `## Log` — and each wrote its own version
 * of it. There is one here now, because the fiddly parts are the same every
 * time: find the heading without being fooled by one inside a code fence, and
 * insert at the end of that section rather than the end of the file.
 *
 * Nothing here rewrites an existing line. A section append only ever inserts.
 */

const FENCE = /^[ \t]*(```|~~~)/;
const HEADING = /^#{1,6}[ \t]/;

/**
 * Insert `line` as the last line of the `## <heading>` section, or create that
 * section at the end of the note when it has none. Returns the new content and
 * where the line ended up.
 *
 * Pure, and append-only: every existing line keeps its text and, except for
 * lines after the insertion point, its number. Trailing blank lines inside the
 * section are kept below the new line so the note's spacing survives.
 *
 * General markdown surgery rather than anything to do with time; `people.ts`
 * appends its log lines with it too. It wants a module of its own, shared with
 * `capture.ts`, which does the same thing for a `## <day>` heading.
 */
export function appendUnderHeading(
	content: string,
	heading: string,
	line: string
): { content: string; line: number } {
	const lines = content.split('\n');
	const wanted = heading.trim().toLowerCase();
	let fence: string | null = null;
	let at = -1;

	for (let i = 0; i < lines.length; i++) {
		const f = FENCE.exec(lines[i]);
		if (f) {
			if (fence === null) fence = f[1];
			else if (f[1] === fence) fence = null;
			continue;
		}
		if (fence === null && lines[i].trim().toLowerCase() === wanted) {
			at = i;
			break;
		}
	}

	if (at === -1) {
		const body = content.replace(/\s+$/, '');
		const prefix = body ? `${body}\n\n` : '';
		const added = `${prefix}${heading}\n${line}\n`;
		return { content: added, line: added.split('\n').length - 2 };
	}

	let end = lines.length;
	for (let i = at + 1; i < lines.length; i++) {
		if (HEADING.test(lines[i])) {
			end = i;
			break;
		}
	}
	let insert = end;
	while (insert > at + 1 && lines[insert - 1].trim() === '') insert--;
	lines.splice(insert, 0, line);
	return { content: lines.join('\n'), line: insert };
}
