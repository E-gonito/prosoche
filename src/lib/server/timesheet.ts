/**
 * The work timesheet: read, never written.
 *
 * `Work/Atlas/TIMESHEET <MONTH>.md` holds one `# DD/MM/YYYY`
 * section per working day. The real shape, verified against the July, August
 * and September files rather than against the spec, is:
 *
 *     # 01/09/2026
 *     10:35 AM Start
 *     Break
 *     6:30 PM Leave
 *     ## Tasks to do
 *     1) For data portal, look at the user requirements branch
 *     6) Integration across apps
 *     	1) End-to-end tests
 *     ## What's been done
 *     1) Non-technical grading walkthrough session
 *     ```
 *     free narrative, sometimes with its own numbered plan and DONE markers
 *     ```
 *     **BLOCKERS:** QMS documents
 *
 * Three things the spec got wrong, and this parser follows the file:
 *
 *  - The numbered lists are `1)`, not `1.`, so markdown does not see them as
 *    lists at all. They are paragraphs with a number in front, they may be
 *    separated by blank lines, and they may carry tab-indented `1)` children.
 *  - A day is not two fixed sections. `## Tasks to do` and `## What's been
 *    done` are the common pair, but the same files also carry `## Timetracker`,
 *    `## Traceability`, `## State model`, `## Coverage claim` and `###`
 *    sub-headings, plus tables and fenced narrative that belong to no heading.
 *    A day is therefore an ordered list of whatever sections it has.
 *  - The time lines are not times. The keyword is a *suffix* (`Start`, `Break`,
 *    `Leave`) and whatever precedes it is free text: `10:35 AM`, `1 Hour`,
 *    `40 minutes`, `1:00 - 2:00 PM`, `NO`, `Cool off`, or nothing at all.
 *    Parsing them as clock times would lose two thirds of them.
 *
 * **There is no writer, and there must not be one.** This document is shared
 * at work: its numbered lists are the record of a day, their numbers are cited
 * in conversations, and a rewrite that renumbered or reflowed them would
 * silently change a document the user is accountable for. The hub therefore
 * treats it exactly like a photograph — parse, render, link out to Obsidian.
 * Anything the hub wants to *add* to a day goes in a real task line elsewhere
 * in the workspace, as decision 13 of the spec fixes.
 */

import { config } from './config';
import { basename } from './parse/note';
import type { Vault } from './vault/index';

/** One `Start`, `Break` or `Leave` line. `value` is the free text in front. */
export interface ClockEntry {
	label: 'start' | 'break' | 'leave';
	/** Text before the keyword, trimmed. Empty when the line is bare. */
	value: string;
	/** The line exactly as written. */
	raw: string;
	line: number;
}

/** One `1)` item, with any tab-indented `1)` children under it. */
export interface TimesheetItem {
	/** The number as written. Duplicates and gaps are kept, not renumbered. */
	number: number;
	/** The item's words, verbatim, with unnumbered continuation lines joined. */
	text: string;
	line: number;
	/** Last line this item covers, children included. */
	endLine: number;
	children: TimesheetItem[];
}

/** A run of lines in a section that is not a numbered item. */
export interface TimesheetBlock {
	/** True when the lines came from a fence. The fence markers are dropped. */
	fenced: boolean;
	text: string;
	line: number;
}

export interface TimesheetSection {
	/** Heading text without the `#`s. Empty for content before any heading. */
	heading: string;
	/** 2 for `##`, 3 for `###`, 0 for the unheaded lead-in. */
	level: number;
	line: number;
	items: TimesheetItem[];
	/** Prose, tables and fenced narrative, in file order. */
	blocks: TimesheetBlock[];
}

export interface TimesheetDay {
	/** `YYYY-MM-DD`, or null when the heading is not a real calendar date. */
	date: string | null;
	/** The heading as written, e.g. `01/09/2026`. */
	heading: string;
	/** 0-based line of the `# DD/MM/YYYY` heading. */
	line: number;
	/** Last line of the day, inclusive. */
	endLine: number;
	clock: ClockEntry[];
	sections: TimesheetSection[];
	/** Text after `**BLOCKERS:**`; `''` when the line is there but empty, null when absent. */
	blockers: string | null;
}

export interface Timesheet {
	days: TimesheetDay[];
}

/** One timesheet note, summarised so a widget can link to it. */
export interface TimesheetNote {
	path: string;
	/** File name without the extension, e.g. `TIMESHEET SEPTEMBER`. */
	title: string;
	days: number;
	/** The latest day the note contains, as `YYYY-MM-DD`, or null. */
	latest: string | null;
}

export interface TimesheetView {
	/** The day asked for, as `YYYY-MM-DD`. */
	date: string;
	/** The note the day came from, else the most recent note, else null. */
	path: string | null;
	/** The day's section, or null when the user has not written one yet. */
	day: TimesheetDay | null;
	/**
	 * The latest day written before this one, so an empty today can point at
	 * the last one filled in. Weekends and days off are the normal case here.
	 */
	previous: { date: string; heading: string; path: string } | null;
	/** Every timesheet note found, latest day first. */
	notes: TimesheetNote[];
	/** The folders searched, joined, so an empty state can name them. */
	folder: string;
}

const DAY_HEADING = /^#[ \t]+(\d{1,2})\/(\d{1,2})\/(\d{4})[ \t]*$/;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const FENCE = /^[ \t]*(```|~~~)/;
const ITEM = /^([ \t]*)(\d{1,3})[).][ \t]*(.*)$/;
const CLOCK = /^(.*?)[ \t]*\b(start|break|leave)\b[ \t]*$/i;
const BLOCKERS = /^\*{0,2}BLOCKERS?:?\*{0,2}[ \t]*(.*?)[ \t]*$/i;

/**
 * Parse a whole timesheet note into its day sections.
 *
 * Pure: takes the file's text, returns structure, touches nothing. Lines the
 * parser has no model for are kept verbatim as blocks rather than dropped, so
 * rendering a parsed day shows everything the file says. Text outside any
 * `# DD/MM/YYYY` heading is ignored, because in these files that is only the
 * odd stray note above the first day.
 *
 * Never writes, and never returns a day the file does not contain.
 */
export function parseTimesheet(content: string): Timesheet {
	const lines = content.split('\n');
	const days: TimesheetDay[] = [];
	let day: DayBuilder | null = null;
	let fence: string | null = null;
	let fenced: { text: string[]; line: number } | null = null;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const fenceMark = raw.match(FENCE);

		// Inside a fence nothing is a heading, an item or a clock line. The
		// September file's narrative contains its own numbered plan, and
		// reading those as items would invent work the day does not claim.
		if (fence) {
			if (fenceMark && raw.trim().startsWith(fence)) {
				if (fenced && day) day.fencedBlock(fenced);
				fence = null;
				fenced = null;
			} else if (fenced) {
				fenced.text.push(raw);
			}
			continue;
		}
		if (fenceMark) {
			fence = fenceMark[1];
			fenced = { text: [], line: i };
			continue;
		}

		const dayHeading = raw.match(DAY_HEADING);
		if (dayHeading) {
			if (day) days.push(day.done(i - 1));
			day = new DayBuilder(dayHeading, i);
			continue;
		}
		if (!day) continue;
		day.line(raw, i);
	}
	if (fenced && fence && day) day.fencedBlock(fenced);
	if (day) days.push(day.done(lines.length - 1));
	return { days };
}

/**
 * Find the timesheet notes in the vault and pull out one day.
 *
 * Reads through the vault module only. `date` is a `YYYY-MM-DD` label; the
 * files write `DD/MM/YYYY`, and this is the one place that conversion lives.
 * `folders` narrows where to look, so a workspace sees its own timesheet
 * rather than someone else's; it defaults to the configured folder.
 *
 * A missing folder, a vault with no timesheet at all and a day the user has
 * not filled in are all ordinary results, not errors: the view comes back with
 * `day: null`, the note's other days, and enough context for the widget to say
 * which of those happened.
 *
 * Never writes to the vault.
 */
export async function timesheetFor(vault: Vault, date: string, folders?: readonly string[]): Promise<TimesheetView> {
	const roots = (folders?.length ? folders : [config.timesheet.folder]).filter(Boolean);
	const folder = roots.join(', ') || 'the vault';
	const prefix = config.timesheet.filePrefix.toLowerCase();
	const paths = (await vault.list()).filter((path) => {
		if (roots.length && !roots.some((root) => path === root || path.startsWith(`${root}/`))) return false;
		return basename(path).toLowerCase().startsWith(prefix);
	});

	const notes: TimesheetNote[] = [];
	let found: { path: string; day: TimesheetDay } | null = null;
	let previous: TimesheetView['previous'] = null;

	for (const path of paths) {
		const note = await vault.read(path);
		if (!note.exists) continue;
		const sheet = parseTimesheet(note.content);
		const dates = sheet.days.map((d) => d.date).filter((d): d is string => d !== null);
		notes.push({
			path,
			title: basename(path),
			days: sheet.days.length,
			latest: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null
		});
		// Later days win, so a date written twice shows the latest version.
		const match = sheet.days.filter((d) => d.date === date).pop();
		if (match) found = { path, day: match };
		for (const earlier of sheet.days) {
			if (!earlier.date || earlier.date >= date) continue;
			if (!previous || earlier.date > previous.date) previous = { date: earlier.date, heading: earlier.heading, path };
		}
	}

	notes.sort((a, b) => (b.latest ?? '').localeCompare(a.latest ?? '') || a.path.localeCompare(b.path));
	return { date, path: found?.path ?? notes[0]?.path ?? null, day: found?.day ?? null, previous, notes, folder };
}

/**
 * Build the day section builder incrementally, because a day's content is
 * decided by lines that arrive one at a time and a section by the heading
 * above it. Kept private: the module's contract is the parsed shape, not how
 * it is assembled.
 */
class DayBuilder {
	private readonly day: TimesheetDay;
	private section: TimesheetSection;
	/** Items by indent width, so a tab-indented `1)` nests under its parent. */
	private stack: Array<{ indent: number; item: TimesheetItem }> = [];
	private prose: { text: string[]; line: number } | null = null;
	/** Clock lines are only read before the first heading, where they live. */
	private inPreamble = true;

	constructor(heading: RegExpMatchArray, line: number) {
		const [, d, m, y] = heading;
		this.day = {
			date: toIsoDate(y, m, d),
			heading: `${d}/${m}/${y}`,
			line,
			endLine: line,
			clock: [],
			sections: [],
			blockers: null
		};
		this.section = { heading: '', level: 0, line: line + 1, items: [], blocks: [] };
	}

	line(raw: string, index: number): void {
		const heading = raw.match(HEADING);
		if (heading) {
			this.closeSection();
			this.inPreamble = false;
			this.section = { heading: heading[2], level: heading[1].length, line: index, items: [], blocks: [] };
			return;
		}

		if (!raw.trim()) {
			// A blank line ends an item and a paragraph but never a section: the
			// files put blank lines between items freely.
			this.stack = [];
			this.closeProse();
			return;
		}

		if (this.inPreamble) {
			const clock = raw.match(CLOCK);
			if (clock) {
				this.day.clock.push({
					label: clock[2].toLowerCase() as ClockEntry['label'],
					value: clock[1].trim(),
					raw,
					line: index
				});
				return;
			}
		}

		const blockers = raw.trim().match(BLOCKERS);
		if (blockers) {
			// One per day, at its end. Extracted rather than left in a block so
			// the widget can say "no blockers" instead of showing a bare label.
			this.day.blockers = blockers[1];
			this.closeProse();
			this.stack = [];
			return;
		}

		const item = raw.match(ITEM);
		if (item) {
			this.closeProse();
			this.addItem(item[1].length, { number: Number(item[2]), text: item[3].trim(), line: index, endLine: index, children: [] });
			return;
		}

		// An indented line under an item continues it; anything else is prose.
		const deepest = this.stack[this.stack.length - 1];
		if (deepest && /^[ \t]+\S/.test(raw)) {
			deepest.item.text = `${deepest.item.text}\n${raw.trim()}`.trim();
			this.grow(index);
			return;
		}

		this.stack = [];
		if (!this.prose) this.prose = { text: [], line: index };
		this.prose.text.push(raw);
	}

	fencedBlock(fenced: { text: string[]; line: number }): void {
		this.closeProse();
		this.stack = [];
		const text = trimBlankEdges(fenced.text).join('\n');
		if (text.trim()) this.section.blocks.push({ fenced: true, text, line: fenced.line });
	}

	done(endLine: number): TimesheetDay {
		this.closeSection();
		this.day.endLine = endLine;
		return this.day;
	}

	private addItem(indent: number, item: TimesheetItem): void {
		while (this.stack.length && this.stack[this.stack.length - 1].indent >= indent) this.stack.pop();
		const parent = this.stack[this.stack.length - 1];
		if (parent) parent.item.children.push(item);
		else this.section.items.push(item);
		this.stack.push({ indent, item });
		this.grow(item.line);
	}

	/** An item's span covers its children, so a caller can highlight the block. */
	private grow(line: number): void {
		for (const entry of this.stack) entry.item.endLine = Math.max(entry.item.endLine, line);
	}

	private closeProse(): void {
		if (!this.prose) return;
		const text = trimBlankEdges(this.prose.text).join('\n');
		if (text.trim()) this.section.blocks.push({ fenced: false, text, line: this.prose.line });
		this.prose = null;
	}

	private closeSection(): void {
		this.closeProse();
		this.stack = [];
		if (this.section.items.length || this.section.blocks.length || this.section.level > 0) {
			this.day.sections.push(this.section);
		}
	}
}

/** `DD/MM/YYYY` parts to `YYYY-MM-DD`, or null when they are not a real day. */
function toIsoDate(y: string, m: string, d: string): string | null {
	const year = Number(y);
	const month = Number(m);
	const dayOfMonth = Number(d);
	const date = new Date(year, month - 1, dayOfMonth);
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== dayOfMonth) return null;
	return `${y}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
}

function trimBlankEdges(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && !lines[start].trim()) start++;
	while (end > start && !lines[end - 1].trim()) end--;
	return lines.slice(start, end);
}
