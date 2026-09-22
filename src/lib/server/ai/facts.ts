/**
 * What a workspace actually contains, as figures the model can be handed.
 *
 * Retrieval finds prose. Prose does not say how many hours went into eye2gene
 * this week, which cards are overdue, or what has been sitting in "In
 * progress" since August — the index and the daily notes know all three, and
 * until now nothing put them in front of the model. So "where did my eye2gene
 * time go this week" came back as "the notes do not say", which was true of
 * the passages and false of the vault.
 *
 * This module answers that by computing the figures the same way the widgets
 * do — `weekSummary` for the time, `buildBoard` for the cards, `findTasks`
 * for overdue and blocked, `workspaceFor` for a daily block that names the
 * project in its own words — and rendering them as a short markdown block.
 * No model is involved in producing them, and nothing here writes: a fact is
 * a query result, and a query result that had been through a model would not
 * be a fact any more.
 *
 * ## Two shapes were considered
 *
 * One function returning the markdown, as the plan sketched it, or a data
 * structure with a pure renderer over it. The second, because the Insights
 * widget has to say what the model will see without paying to render it, the
 * bytes are worth table-testing on their own, and a truncation rule is much
 * easier to get right over a list than over a string.
 */

import { buildBoard } from '../board';
import { config } from '../config';
import { dailyNotePath, type DayKey } from '../daily';
import type { NoteIndex } from '../index/index';
import { weekOf, weekSummary, type WeekSummary } from '../timelog';
import type { Vault } from '../vault/index';
import { workspaceFor, type Workspace } from '../workspaces';
import { estimateTokens } from '$lib/shared/ai';
import { formatDuration } from '$lib/shared/duration';
import { OPEN_STATUSES, displayText, isOpen, taskMinutes, type Task } from '$lib/shared/task';

export interface FactsDeps {
	vault: Vault;
	index: NoteIndex;
	workspaces: Workspace[];
}

/** One task, reduced to what a line of the facts block says about it. */
export interface FactCard {
	text: string;
	due: string | null;
	quadrant: number | null;
	/** Ids this card waits on, for the blocked list. */
	blockedBy: string[];
	path: string;
}

/** One board column: its true size, and the first few of its open cards. */
export interface FactColumn {
	title: string;
	count: number;
	cards: FactCard[];
}

/** One line of a daily note this workspace claims, timed or not. */
export interface FactBlock {
	day: DayKey;
	text: string;
	/** The block's own length, or 0 for a line with no clock on it. */
	plannedMinutes: number;
	done: boolean;
}

export interface FactNote {
	path: string;
	title: string;
}

/** Everything the facts block says, before it is words. */
export interface WorkspaceFacts {
	slug: string;
	name: string;
	/** The day the figures were computed for, which dates "overdue". */
	day: DayKey;
	/** The seven days of `day`'s week, Monday first. */
	week: DayKey[];
	summary: WeekSummary;
	columns: FactColumn[];
	overdue: FactCard[];
	blocked: FactCard[];
	blocks: FactBlock[];
	notes: FactNote[];
}

/** How big the facts are, for a surface that wants to say so before asking. */
export interface FactCounts {
	cards: number;
	overdue: number;
	blocked: number;
	blocks: number;
	/** Done plus timed this week: the time that actually happened. */
	weekMinutes: number;
}

/** Cards listed per column, as the plan fixes it. The rest is the true count. */
const CARDS_PER_COLUMN = 8;

/** How many overdue or blocked lines are read at all. Nobody reads fifty. */
const LIST_LIMIT = 50;

const RECENT_NOTES = 10;

/**
 * The most the rendered block may cost, in `estimateTokens`' rough tokens.
 *
 * A ceiling rather than a target: the block is prepended to the prompt and
 * the retrieval budget is reduced by whatever it actually costs, so a cheap
 * week leaves more room for prose rather than padding the figures out.
 */
export const FACTS_TOKEN_CAP = 1500;

/** Items per list, tried in turn until the whole block fits under the cap. */
const LADDER = [CARDS_PER_COLUMN, 6, 4, 3, 2, 1, 0];

/** A card's words past this are clipped: one line per item, always. */
const MAX_TEXT = 100;

/**
 * Gather everything known about a workspace on one day.
 *
 * Inputs: the vault, the index and every workspace (attribution needs the
 * others, since a block claimed by Kaya is not eye2gene's); the workspace in
 * question; and the day the figures are for, which is what "this week" and
 * "overdue" are relative to. Output: the figures, unrendered.
 *
 * Side effects: queries the index and reads the week's daily notes. Runs no
 * model, writes nothing, and never reaches outside the workspace: every list
 * is filtered by the same ownership rule the board and the Time widget use,
 * so the facts and the screens cannot disagree.
 */
export async function gatherWorkspaceFacts(
	deps: FactsDeps,
	workspace: Workspace,
	day: DayKey
): Promise<WorkspaceFacts> {
	const week = weekOf(day);
	const summary = await weekSummary(deps.vault, deps.index, {
		days: week,
		workspaces: deps.workspaces,
		workspace
	});

	// Finished columns empty themselves: a card that is done is not something
	// the model can be asked what to do about.
	const columns = buildBoard(deps.index, workspace, deps.workspaces)
		.columns.map((column) => {
			const open = column.cards.map((card) => card.task).filter(isOpen);
			return { title: column.title, count: open.length, cards: open.slice(0, CARDS_PER_COLUMN).map(toCard) };
		})
		.filter((column) => column.count > 0);

	const claimed = {
		tags: [workspace.tag],
		under: workspace.folders,
		paths: [workspace.deck],
		statuses: OPEN_STATUSES,
		excludeDailyNotes: true,
		excludePrefixes: [`${config.hubFolder}/`],
		limit: LIST_LIMIT
	};
	const overdue = deps.index.findTasks({ ...claimed, dueOnOrBefore: day }).map(toCard);
	const blocked = deps.index.findTasks({ ...claimed, blocked: true }).map(toCard);

	// The daily notes are the other half of the record, and the half this
	// vault actually writes: "10:30 - 18:00 Work on eye2gene" carries no tag,
	// so only `workspaceFor` knows whose afternoon it was.
	const blocks = week.flatMap((d) =>
		deps.index
			.tasksIn(dailyNotePath(d))
			.filter((task) => !task.fenced)
			.filter(
				(task) =>
					workspaceFor(deps.workspaces, { path: task.path, tags: task.tags, text: task.text })?.slug ===
					workspace.slug
			)
			.map((task) => ({
				day: d,
				text: displayText(task.text),
				plannedMinutes: taskMinutes(task),
				done: task.status === 'done'
			}))
	);

	const notes = deps.index
		.notes({ under: workspace.folders, excludePrefixes: [`${config.hubFolder}/`], limit: RECENT_NOTES })
		.map((note) => ({ path: note.path, title: note.title }));

	return { slug: workspace.slug, name: workspace.name, day, week, summary, columns, overdue, blocked, blocks, notes };
}

/**
 * How much the model is about to be told, in four numbers and a duration.
 *
 * Pure. Here rather than in the widget so that "14 open cards" on screen and
 * fourteen lines in the prompt are the same count by construction.
 */
export function factCounts(facts: WorkspaceFacts): FactCounts {
	return {
		cards: facts.columns.reduce((total, column) => total + column.count, 0),
		overdue: facts.overdue.length,
		blocked: facts.blocked.length,
		blocks: facts.blocks.length,
		weekMinutes: facts.summary.doneMinutes + facts.summary.loggedMinutes
	};
}

/**
 * The facts as markdown, for the prompt.
 *
 * Pure, so the exact bytes are table-tested. Inputs: the figures. Output: a
 * block of short headings and one line per item, ending in a newline.
 *
 * Never emits an empty heading: a workspace with nothing in it is one
 * sentence, because three bare headings read as a bug and cost tokens saying
 * nothing. Never exceeds `FACTS_TOKEN_CAP` estimated tokens either — the
 * lists are shortened, each ending in "and N more", until it fits, so a
 * workspace with four hundred cards costs the same as one with twelve.
 */
export function renderFacts(facts: WorkspaceFacts): string {
	for (const limit of LADDER) {
		const text = compose(facts, limit);
		if (estimateTokens(text) <= FACTS_TOKEN_CAP) return text;
	}
	// Unreachable with any plausible vault: the floor is a heading per column
	// and a line per day. Kept so the contract holds whatever arrives.
	const text = compose(facts, 0);
	return estimateTokens(text) <= FACTS_TOKEN_CAP
		? text
		: `${text.slice(0, FACTS_TOKEN_CAP * 4 - 40).trimEnd()}\nand more.\n`;
}

/** The whole block with every list cut to `limit` items. */
function compose(facts: WorkspaceFacts, limit: number): string {
	const lines = [`# ${facts.name}, computed from the notes on ${facts.day}`];
	const section = (heading: string, body: string[]): void => {
		if (body.length) lines.push('', heading, ...body);
	};

	const week = weekLines(facts.summary);
	section(`## This week (${facts.week[0]} to ${facts.week[facts.week.length - 1]})`, week);

	const cards: string[] = [];
	for (const column of facts.columns) {
		cards.push(`### ${column.title} (${column.count})`);
		cards.push(...listLines(column.cards, limit, column.count, (card) => cardLine(card)));
	}
	section(`## Open cards (${facts.columns.reduce((total, c) => total + c.count, 0)})`, cards);

	section(
		`## Overdue (${facts.overdue.length})`,
		listLines(facts.overdue, limit, facts.overdue.length, (card) => cardLine(card, card.path))
	);
	section(
		`## Blocked (${facts.blocked.length})`,
		listLines(facts.blocked, limit, facts.blocked.length, (card) =>
			cardLine(card, card.blockedBy.length ? `waiting on ${card.blockedBy.join(', ')}` : '', card.path)
		)
	);
	section(`## Blocks this week (${facts.blocks.length})`, listLines(facts.blocks, limit, facts.blocks.length, blockLine));
	section(
		`## Recently changed notes (${facts.notes.length})`,
		listLines(facts.notes, limit, facts.notes.length, (note) => `${clip(note.title)} — ${note.path}`)
	);

	if (lines.length === 1) {
		lines.push('', 'Nothing planned, nothing open, and no notes changed recently.');
	}
	return `${lines.join('\n')}\n`;
}

/** The week's totals, then only the days something happened on. */
function weekLines(summary: WeekSummary): string[] {
	if (!summary.plannedMinutes && !summary.doneMinutes && !summary.loggedMinutes) return [];
	const lines = [
		`- ${formatDuration(summary.doneMinutes)} done and ${formatDuration(summary.loggedMinutes)} timed, of ${formatDuration(summary.plannedMinutes)} planned.`
	];
	for (const day of summary.days) {
		if (!day.plannedMinutes && !day.doneMinutes && !day.loggedMinutes) continue;
		lines.push(
			`- ${label(day.day)}: ${formatDuration(day.plannedMinutes)} planned, ${formatDuration(day.doneMinutes)} done, ${formatDuration(day.loggedMinutes)} timed.`
		);
	}
	return lines;
}

/** `limit` items as bullets, then what was left out, as one honest line. */
function listLines<T>(items: T[], limit: number, count: number, line: (item: T) => string): string[] {
	const shown = items.slice(0, limit);
	const out = shown.map((item) => `- ${line(item)}`);
	const more = count - shown.length;
	if (more > 0) out.push(`- and ${more} more.`);
	return out;
}

function cardLine(card: FactCard, ...extras: string[]): string {
	const parts = [clip(card.text)];
	if (card.due) parts.push(`due ${card.due}`);
	if (card.quadrant) parts.push(`Q${card.quadrant}`);
	parts.push(...extras.filter(Boolean));
	return parts.join(' — ');
}

function blockLine(block: FactBlock): string {
	const parts = [`${label(block.day)}: ${clip(block.text)}`];
	if (block.plannedMinutes) parts.push(formatDuration(block.plannedMinutes));
	parts.push(block.done ? 'done' : 'not done');
	return parts.join(' — ');
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `Mon 2026-09-21`. The name is a label for the model, not a locale format. */
function label(day: DayKey): string {
	const [y, m, d] = day.split('-').map(Number);
	return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${day}`;
}

/** One line per item means one line: a card with a paragraph in it is cut. */
function clip(text: string): string {
	const one = text.replace(/\s+/g, ' ').trim();
	return one.length <= MAX_TEXT ? one : `${one.slice(0, MAX_TEXT - 1).trimEnd()}…`;
}

function toCard(task: Task): FactCard {
	return {
		text: displayText(task.text),
		due: task.due,
		quadrant: task.quadrant,
		blockedBy: task.blockedBy,
		path: task.path
	};
}
