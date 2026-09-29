/**
 * A workspace's dated log: `<home>/Log.md`, one `## YYYY-MM-DD` heading per
 * session.
 *
 * Sessions are appended, never reordered — the file always grows downward,
 * oldest first, the way `appendUnderHeading` writes everything — but they are
 * always read back newest first, because that is the order a person wants to
 * catch up in. The sort is display only; nothing here ever rewrites the file.
 */

import { appendUnderHeading } from './sections';
import { today, type DayKey } from './daily';
import type { Vault } from './vault/index';

const DAY_HEADING = /^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*$/;
const ANY_HEADING = /^#{1,6}[ \t]/;

export interface LogEntry {
	day: DayKey;
	/** Bullet and prose lines under the heading, in file order, trimmed. */
	lines: string[];
}

/** Every `## <day>` section of a Log.md, newest day first. */
export function readLog(content: string): LogEntry[] {
	const entries: LogEntry[] = [];
	let current: LogEntry | null = null;

	for (const raw of content.split('\n')) {
		if (ANY_HEADING.test(raw)) {
			const heading = DAY_HEADING.exec(raw);
			current = heading ? { day: heading[1], lines: [] } : null;
			if (current) entries.push(current);
			continue;
		}
		if (current && raw.trim()) current.lines.push(raw.trim());
	}

	return entries.sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * Append one bullet under today's heading in `path`, creating both the file
 * and the heading when they do not exist yet. Never rewrites an earlier day.
 */
export async function addLogUpdate(vault: Vault, path: string, text: string, day: DayKey = today()): Promise<boolean> {
	const trimmed = text.replace(/\s+/g, ' ').trim();
	if (!trimmed) return false;

	const note = await vault.read(path);
	const base = note.exists ? note.content : '# Log\n';
	const next = appendUnderHeading(base, `## ${day}`, `- ${trimmed}`);
	const result = await vault.write(path, next.content, note.exists ? note.hash : undefined);
	return result.ok;
}
