/**
 * A workspace's board as the browser sees it, and the operations it may ask
 * for.
 *
 * The board is `<home>/Board.md` in the Obsidian Kanban plugin's format; the
 * grammar that reads and edits it lives in `$lib/server/parse/kanban.ts` and
 * nowhere else. This file is only the contract between that server side and
 * the components: plain data, no spans, no file access, no clock.
 *
 * Cards and columns are addressed by position — a card by the 0-based line it
 * starts on, a column by its index — and every operation travels with the
 * hash of the file it was computed against. A stale hash is refused, so a
 * line number can never land on a card someone else has since moved.
 */

/** One card: a `- [ ]` item and its indented notes. */
export interface BoardCard {
	/** 0-based line of the card's `- [ ]` line in `Board.md`. */
	line: number;
	/** The first line's words, without its due date, priority or labels. */
	title: string;
	/** `YYYY-MM-DD` from `@{…}`, or null. */
	due: string | null;
	/** 1..4 from `` `Q1` ``, or null. */
	priority: number | null;
	/** Labels without `#`, in written order. */
	labels: string[];
	/** The continuation lines, dedented, joined with `\n`. Empty for none. */
	notes: string;
	/** True for any checkbox but `[ ]`, as the plugin reads it. */
	done: boolean;
}

export interface BoardColumn {
	title: string;
	/** The plugin's WIP limit, written `Doing (3)`; 0 for none. */
	limit: number;
	/** The plugin's `**Complete**` marker: a card moved in is ticked. */
	complete: boolean;
	cards: BoardCard[];
}

export interface Board {
	/** The workspace's slug. */
	workspace: string;
	/** Vault-relative path of the board file. */
	path: string;
	/** Hash of the bytes this board was read from; send it back with an op. */
	hash: string;
	/** False for a board that has never been written: the default columns. */
	exists: boolean;
	columns: BoardColumn[];
}

/**
 * Everything a board can be asked to do. Each is one small edit of the file:
 * a span of one line, the lines of one card, or the lines of one column.
 */
export type BoardOp =
	/** Append a card; `text` is quick-add text such as "Call landlord fri Q1 #legal". */
	| { kind: 'add-card'; column: number; text: string }
	/** Change only the fields given. `notes: ''` removes the notes. */
	| {
			kind: 'edit-card';
			line: number;
			title?: string;
			due?: string | null;
			priority?: number | null;
			labels?: string[];
			notes?: string;
	  }
	| { kind: 'toggle-card'; line: number; done: boolean }
	/** `index` is the card's position in the target column once it is there. */
	| { kind: 'move-card'; line: number; column: number; index: number }
	/** Omit `index` to add the column at the end. */
	| { kind: 'add-column'; title: string; index?: number }
	| { kind: 'rename-column'; column: number; title: string }
	/** `index` is the column's position once moved. */
	| { kind: 'move-column'; column: number; index: number }
	/** Refused unless the column holds no cards and nothing else. */
	| { kind: 'delete-column'; column: number };

/** An open card with a due date or a claim on Today, and where it lives. */
export interface OpenCard extends BoardCard {
	workspace: { slug: string; name: string; color: string };
	/** The board file, for a tick sent back from Today. */
	path: string;
	/** That file's hash when the card was read. */
	hash: string;
	/** Title of the column the card sits in. */
	column: string;
}

/**
 * A due date as a chip reads it, from `today`'s point of view: "Today",
 * "Tomorrow", "Yesterday", a weekday name within the coming week ("Fri"),
 * and otherwise "3 Oct", with the year only when it is not this one. Both
 * arguments are `YYYY-MM-DD`; nothing here reads a clock.
 */
export function dueLabel(due: string, today: string): string {
	const days = Math.round((utc(due) - utc(today)) / 86_400_000);
	if (days === 0) return 'Today';
	if (days === 1) return 'Tomorrow';
	if (days === -1) return 'Yesterday';
	const date = new Date(utc(due));
	if (days > 1 && days < 7) return date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
	const sameYear = due.slice(0, 4) === today.slice(0, 4);
	return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
}

function utc(day: string): number {
	const [y, m, d] = day.split('-').map(Number);
	return Date.UTC(y, m - 1, d);
}

/**
 * Most urgent first: priority Q1 to Q4, then the soonest due date, then where
 * the card sits, so the order is stable between loads. A card with no
 * priority or no due date sorts after those that have one.
 *
 * Display order only; nothing here moves a card in the file.
 */
export function compareCards(a: BoardCard, b: BoardCard): number {
	const byPriority = (a.priority ?? 9) - (b.priority ?? 9);
	if (byPriority !== 0) return byPriority;
	const byDue = (a.due ?? '\uffff').localeCompare(b.due ?? '\uffff');
	if (byDue !== 0) return byDue;
	return a.line - b.line;
}
