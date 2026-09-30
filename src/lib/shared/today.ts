/**
 * The shape of the Today dashboard, shared between `$server/today.ts`, which
 * builds it, and the components that render it.
 *
 * A page component may not import `$lib/server/*` — that boundary is what
 * keeps the filesystem and the database out of the browser bundle — so the
 * one contract between the two lives here, the same way `DraftResult` does
 * in `shared/ai.ts`. Everything below is data; nothing here reads a clock or
 * touches a vault.
 */

import type { Task } from './task';
import type { OpenCard } from './kanban';
import type { InboxLine } from './inbox';

export interface Owner {
	slug: string;
	name: string;
	color: string;
}

/**
 * A calendar event, reduced to what a screen draws: no organiser, no
 * description, no attendee list Today has no room for. It links nowhere.
 */
export interface TodayEvent {
	id: string;
	title: string;
	/** Minutes since local midnight; null for an all-day event. */
	startMin: number | null;
	endMin: number | null;
}

export interface WorkspaceGroup {
	slug: string;
	name: string;
	color: string;
	/** The open cards on the workspace's board, most urgent first, already capped. */
	cards: OpenCard[];
	/** How many more open cards the workspace has beyond those shown. */
	more: number;
	/** Unfiled lines of `Inbox/Capture.md` carrying the workspace's tag or an alias. */
	inboxCount: number;
}

/** One module's card on the dashboard. See `$lib/modules/today.server.ts`. */
export interface TodayCard {
	module: string;
	title: string;
	href: string;
	items: Array<{ text: string; meta?: string; href?: string }>;
}

export interface TodayData {
	day: string;
	label: string;
	relative: string;
	isToday: boolean;
	/** The real current day, `YYYY-MM-DD`, whatever day is being viewed — for
	 *  judging a workspace card's due date against, the same way the overdue
	 *  section itself is. */
	today: string;
	prev: string;
	next: string;
	path: string;
	exists: boolean;
	conflicted: boolean;
	scheduled: Task[];
	unscheduled: Task[];
	owners: Record<string, Owner>;
	plannedMinutes: number;
	overlaps: number;
	/** The day's tasks, each in exactly one of the three. */
	counts: { done: number; skipped: number; open: number };
	/** Whether Today links to the evening review: a past day, or today from 18:00. */
	offerReview: boolean;
	/** The viewed day's calendar events, read-only blocks on the timeline. */
	events: TodayEvent[];
	/** Set only when the feed is configured and unreachable; absent is calm. */
	calendarProblem: string | null;
	aiEnabled: boolean;
	/** The note's own briefing region, read like any other text. */
	briefingText: string | null;
	/** Open tasks overdue as of the real today, from anywhere but a daily note or a board. */
	overdue: Task[];
	overdueOwners: Record<string, Owner>;
	/** Open board cards overdue as of the real today, soonest first. */
	overdueCards: OpenCard[];
	workspaces: WorkspaceGroup[];
	/**
	 * Monday to Sunday of the viewed day's week: each day's tasks done, and
	 * owed (done plus open). Skipped tasks are counted apart, in neither.
	 */
	week: Array<{ day: string; done: number; skipped: number; total: number }>;
	/** `Inbox/Capture.md`'s unfiled lines: how many, and the newest few. */
	inbox: { count: number; lines: InboxLine[] };
	cards: TodayCard[];
	summary: string;
}
