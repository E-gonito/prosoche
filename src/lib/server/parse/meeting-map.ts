/**
 * Which workspace each calendar event belongs to, remembered by event title:
 * `_hub/meetings.md`, one line per title.
 *
 *     - Dev Weekly Meeting → eye2gene
 *     - Standup -> eye2gene
 *
 * It lives in the vault so it syncs and can be corrected in Obsidian. The
 * title is everything before the last arrow; the slug is the single word
 * after it. Any other line is the user's own and is left alone.
 *
 * Pure. Changing a mapping rewrites only the slug on that one line; a new
 * mapping is appended.
 */

export interface MeetingMapping {
	title: string;
	slug: string;
	/** 0-based line in the note. */
	line: number;
}

/** The note a new mapping file starts as. */
export const MEETING_MAP_HEADER = `# Meeting workspaces

Which workspace each calendar event belongs to, by event title. One line per
title, \`- Title → workspace-slug\`. Edit freely; the app rewrites only the
line it changes.

`;

const LINE = /^([ \t]*[-*+][ \t]+)(.+?)([ \t]+(?:→|->)[ \t]+)([\w-]+)([ \t]*\r?)$/;

/** How titles are compared: trimmed, spaced once, lower-case. */
export function titleKey(title: string): string {
	return title.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Every mapping, in file order. A title listed twice keeps its first line. */
export function parseMeetingMap(content: string): MeetingMapping[] {
	const seen = new Set<string>();
	const out: MeetingMapping[] = [];
	content.split('\n').forEach((raw, line) => {
		const m = LINE.exec(raw);
		if (!m) return;
		const key = titleKey(m[2]);
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ title: m[2].trim(), slug: m[4], line });
	});
	return out;
}

/** The slug for a title, or null when it has never been assigned. */
export function slugForTitle(mappings: MeetingMapping[], title: string): string | null {
	const key = titleKey(title);
	return mappings.find((m) => titleKey(m.title) === key)?.slug ?? null;
}

/**
 * Remember `title → slug`. Pure.
 *
 * When the title already has a line, only the slug on that line changes and
 * the rest of the note, that line's own spelling of the title included, is
 * kept byte for byte. Otherwise one line is appended; an empty note gets the
 * explanatory header first.
 */
export function setMapping(content: string, title: string, slug: string): string {
	const existing = parseMeetingMap(content).find((m) => titleKey(m.title) === titleKey(title));
	if (existing) {
		const lines = content.split('\n');
		const m = LINE.exec(lines[existing.line])!;
		lines[existing.line] = `${m[1]}${m[2]}${m[3]}${slug}${m[5]}`;
		return lines.join('\n');
	}
	const line = `- ${title.replace(/\s+/g, ' ').trim()} → ${slug}\n`;
	if (content.trim() === '') return MEETING_MAP_HEADER + line;
	return content.endsWith('\n') ? content + line : `${content}\n${line}`;
}
