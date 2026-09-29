/**
 * The shape of the Today dashboard, shared between `$server/today.ts`, which
 * builds it, and the components that render it.
 *
 * A page component may not import `$lib/server/*` — that boundary is what
 * keeps the filesystem and the database out of the browser bundle — so the
 * one contract between the two lives here, the same way `BriefingRun` does
 * in `shared/ai.ts`. Everything below is data; nothing here reads a clock or
 * touches a vault.
 */

import type { Task } from './task';
import type { OpenCard } from './kanban';

export interface Owner {
	slug: string;
	name: string;
	color: string;
}

/**
 * A calendar event, reduced to what a screen draws: no organiser, no
 * description, no attendee list Today has no room for. `href` already points
 * at the Meetings module, built once on the server rather than assembled
 * again in every place an event is shown.
 */
export interface TodayEvent {
	id: string;
	title: string;
	/** Minutes since local midnight; null for an all-day event. */
	startMin: number | null;
	endMin: number | null;
	href: string;
}

export interface WeekDay {
	day: string;
	/** "Wed 1 Oct". */
	label: string;
	events: TodayEvent[];
	/** Open tasks in that day's own daily note, when it exists. */
	openTasks: Task[];
	/** Open cards on any workspace's board due that day. */
	dueCards: OpenCard[];
}

export interface WorkspaceGroup {
	slug: string;
	name: string;
	color: string;
	/** The open cards on the workspace's board, most urgent first, already capped. */
	cards: OpenCard[];
	/** How many more open cards the workspace has beyond those shown. */
	more: number;
	/** Open lines in `<home>/Inbox.md`. */
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
	doneCount: number;
	totalCount: number;
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
	week: WeekDay[];
	workspaces: WorkspaceGroup[];
	cards: TodayCard[];
	summary: string;
}
