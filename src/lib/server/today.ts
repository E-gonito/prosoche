/**
 * Today: the dashboard for one day.
 *
 * This module composes the vault and the index through the existing core —
 * `daily`, `daily-note`, `kanban`, `workspaces`, `calendar`, the AI proposal
 * layer — into the one object the `/today` routes render. Nothing here is a
 * second copy of a rule: what counts as a workspace's open card is decided
 * once, in `kanban.ts`, and who owns a task in `workspaces.ts`; this module
 * only asks. Read-only throughout; the writes on this page — planning a task
 * onto a day, ticking a card — are `day-plan.ts`'s and `kanban.ts`'s, called
 * from their routes.
 */

import { dailyNotePath, shiftDay, today as todayKey, type DayKey } from './daily';
import { boardPath, openCards } from './kanban';
import { workspaceFor, type Workspace } from './workspaces';
import { coveredMinutes, overlappingCount } from './schedule';
import { eventsBetween } from './calendar';
import { readRegion } from './ai/proposal';
import { BRIEFING_MARKER } from './ai/guardrails';
import { loadSettings } from './ai/settings';
import { CONFLICT_MARKERS, type NoteIndex } from './index/index';
import { config } from './config';
import { formatDuration } from '$lib/shared/duration';
import { relativeDay } from '$lib/shared/links';
import { compareTasks, isOpen, OPEN_STATUSES, type Task } from '$lib/shared/task';
import { compareCards } from '$lib/shared/kanban';
import type { Owner, TodayData, TodayEvent, WorkspaceGroup } from '$lib/shared/today';
import type { Vault } from './vault/index';

export type { Owner, WorkspaceGroup, TodayData };

/**
 * `loadToday`'s own half of the dashboard: everything but the module cards.
 *
 * Split out because module cards are `$lib/modules/today.server.ts`'s
 * contract, not this module's — a module talks to the core, per
 * `docs/plan-rebuild.md`'s ground rules, and core code reaching back up into
 * the module layer would run that rule in reverse. The route composes the
 * two into the full `TodayData` it returns.
 */
type TodayDashboard = Omit<TodayData, 'cards'>;

/** How many of a workspace's open cards the dashboard names before collapsing the rest. */
const WORKSPACE_CARD_LIMIT = 3;

/** How many overdue tasks the dashboard is willing to list. */
const OVERDUE_LIMIT = 40;

/**
 * "Tuesday 29 September", the title's own reading of a day. It leaves out the
 * year, since the title already says "today" or "3 days ago" right beneath it.
 */
function formatTitleDay(day: DayKey): string {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * The one-line summary under the title: "4 of 9 done · 5h 30m planned ·
 * 2 meetings · 3 overdue".
 *
 * Every clause but the count of tasks is dropped once it is zero, because
 * "0 meetings" and "0 overdue" on an ordinary day is noise repeated every
 * morning. The task count never drops, even at 0 of 0, so the line always
 * says something about the day. Pure, so the rule is table-tested on its own.
 */
export function summaryLine(input: { total: number; done: number; plannedMinutes: number; meetings: number; overdue: number }): string {
	const parts = [`${input.done} of ${input.total} done`];
	if (input.plannedMinutes > 0) parts.push(`${formatDuration(input.plannedMinutes, ' ')} planned`);
	if (input.meetings > 0) parts.push(`${input.meetings} meeting${input.meetings === 1 ? '' : 's'}`);
	if (input.overdue > 0) parts.push(`${input.overdue} overdue`);
	return parts.join(' · ');
}

interface TodayDeps {
	vault: Vault;
	index: NoteIndex;
	workspaces: Workspace[];
}

/**
 * Everything the Today dashboard shows for one day.
 *
 * Inputs: the vault, the index and the workspace definitions, and the day
 * being viewed. Output: `TodayData`. Side effects: reads notes, and fetches
 * the calendar feed (cached; see `calendar.ts`). Never writes.
 *
 * `day` is whichever the route names — today or another one the user is
 * looking at — and only the scheduled/unscheduled section and its calendar
 * events follow it. Overdue and the workspace cards are always anchored to
 * the real today: a card due last Tuesday is late whether you are reading
 * Monday's page or Friday's.
 */
export async function loadToday(deps: TodayDeps, day: DayKey, options: { now?: Date } = {}): Promise<TodayDashboard> {
	const { vault, index, workspaces } = deps;
	const real = todayKey(options.now);
	const path = dailyNotePath(day);
	const note = await vault.read(path);
	const tasks = index.tasksIn(path).filter((t) => !t.fenced);

	const scheduled = tasks.filter((t) => t.startMin !== null).sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
	const unscheduled = tasks.filter((t) => t.startMin === null);

	const owners: Record<string, Owner> = {};
	for (const task of tasks) {
		const owner = workspaceFor(workspaces, { path: task.path, tags: task.tags, text: task.text });
		if (owner) owners[key(task)] = { slug: owner.slug, name: owner.name, color: owner.color };
	}

	const dayEvents = await eventsBetween(day, day);

	const settings = await loadSettings(vault);

	// A board's cards are listed as cards below, so a Tasks-plugin due date
	// written on one must not bring it in a second time as a task.
	const boards = new Set(workspaces.map(boardPath));
	const overdue = index
		.findTasks({
			statuses: OPEN_STATUSES,
			dueOnOrBefore: shiftDay(real, -1),
			excludeDailyNotes: true,
			excludePrefixes: [`${config.hubFolder}/`],
			limit: OVERDUE_LIMIT
		})
		.filter((t) => isOpen(t) && !boards.has(t.path))
		.sort(compareTasks);
	const overdueOwners: Record<string, Owner> = {};
	for (const task of overdue) {
		const owner = workspaceFor(workspaces, { path: task.path, tags: task.tags, text: task.text });
		if (owner) overdueOwners[key(task)] = { slug: owner.slug, name: owner.name, color: owner.color };
	}

	// Every open card on every board, read once: the overdue cards and the
	// workspace cards section both come from this rather than reading each
	// board twice.
	const cards = await openCards(vault, workspaces);
	const overdueCards = cards.filter((c) => c.due !== null && c.due < real).sort((a, b) => a.due!.localeCompare(b.due!) || compareCards(a, b));

	const workspaceGroups: WorkspaceGroup[] = [];
	for (const workspace of workspaces) {
		const own = cards.filter((c) => c.workspace.slug === workspace.slug).sort(compareCards);
		const home = workspace.folders[0];
		const inboxCount = home ? countOpenTasks(index, `${home}/Inbox.md`) : 0;
		if (own.length === 0 && inboxCount === 0) continue;
		workspaceGroups.push({
			slug: workspace.slug,
			name: workspace.name,
			color: workspace.color,
			cards: own.slice(0, WORKSPACE_CARD_LIMIT),
			more: Math.max(0, own.length - WORKSPACE_CARD_LIMIT),
			inboxCount
		});
	}

	const doneCount = tasks.filter((t) => t.status === 'done' || t.status === 'cancelled').length;

	return {
		day,
		label: formatTitleDay(day),
		relative: relativeDay(day, real),
		isToday: day === real,
		today: real,
		prev: shiftDay(day, -1),
		next: shiftDay(day, 1),
		path,
		exists: note.exists,
		conflicted: index.problemFor(path) === CONFLICT_MARKERS,
		scheduled,
		unscheduled,
		owners,
		plannedMinutes: coveredMinutes(scheduled),
		overlaps: overlappingCount(scheduled),
		doneCount,
		totalCount: tasks.length,
		events: dayEvents.ok ? dayEvents.events.map(toTodayEvent) : [],
		calendarProblem: dayEvents.ok || dayEvents.reason === 'not-configured' ? null : dayEvents.message,
		aiEnabled: settings.enabled,
		briefingText: note.exists ? readRegion(note.content, BRIEFING_MARKER) : null,
		overdue,
		overdueOwners,
		overdueCards,
		workspaces: workspaceGroups,
		summary: summaryLine({
			total: tasks.length,
			done: doneCount,
			plannedMinutes: coveredMinutes(scheduled),
			meetings: dayEvents.ok ? dayEvents.events.length : 0,
			overdue: overdue.length + overdueCards.length
		})
	};
}

function key(task: Task): string {
	return `${task.path}:${task.line}`;
}

/** A calendar event, reduced to what the dashboard draws. */
function toTodayEvent(event: { id: string; title: string; startMin: number | null; endMin: number | null }): TodayEvent {
	return {
		id: event.id,
		title: event.title,
		startMin: event.startMin,
		endMin: event.endMin
	};
}

/**
 * Open task lines in one note, or 0 when it does not exist.
 *
 * The simpler of the two readings `docs/how-it-works.md`'s Today section
 * offers for an inbox count: a capture that is not yet a task (a bare
 * thought under a day heading) is not counted, only what has already been
 * turned into a `- [ ]` line. Counting bullets too would need the inbox's own
 * day-heading grammar read a second time outside `capture.ts`, for a number
 * that is otherwise exactly what the index already tracks.
 */
function countOpenTasks(index: NoteIndex, path: string): number {
	return index.tasksIn(path).filter((t) => !t.fenced && isOpen(t)).length;
}
