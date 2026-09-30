/**
 * The one shape a task has, on the server and in the browser.
 *
 * There used to be two: the index produced `startMin`/`endMin` numbers while
 * the task-edit endpoint returned the parser's `start`/`end` strings. After a
 * drag the browser received the second shape, read `startMin` as undefined,
 * and the timeline collapsed to nothing. One type, one converter, so that
 * cannot happen again.
 */

export type TaskStatus = 'todo' | 'done' | 'in-progress' | 'cancelled' | 'blocked';

export interface Task {
	path: string;
	line: number;
	blockEnd: number;
	status: TaskStatus;
	/** Minutes since midnight, or null when unscheduled. */
	startMin: number | null;
	endMin: number | null;
	/** Task text as written, markdown included. */
	text: string;
	quadrant: number | null;
	fenced: boolean;
	/** The whole source line, used to detect that it changed underneath. */
	raw: string;
	/** Tags without their `#`, e.g. `ws/work`, `col/review`, `pin`. */
	tags: string[];
	/** The task's own Tasks-plugin id, which other tasks block on. */
	id: string | null;
	/** Ids of tasks that must finish before this one can start. */
	blockedBy: string[];
	/** Due date as written, usually `YYYY-MM-DD`. */
	due: string | null;
}

/**
 * The workspace tags written on the line, e.g. `ws/work`, in written order.
 *
 * Normally one or none. A line carrying two is left as it is and reported as
 * both: the file is the truth, and tidying one away would be an edit nobody
 * asked for. Callers that assign a workspace remove what this returns.
 */
export function workspaceTags(task: Task): string[] {
	return task.tags.filter((t) => t === 'ws' || t.startsWith('ws/'));
}

export const OPEN_STATUSES: TaskStatus[] = ['todo', 'in-progress', 'blocked'];

/**
 * A task is in exactly one of three states: open (still owed), done, or
 * skipped. Skipped is Obsidian's cancelled checkbox, `- [-]`: the day let it
 * go, so it is neither counted as done nor owed. The three predicates below
 * are the one place that sorting happens.
 */
export const isOpen = (task: Task): boolean => OPEN_STATUSES.includes(task.status);

/** Ticked, `[x]` or `[X]`. A skipped task is not done. */
export const isDone = (task: Task): boolean => task.status === 'done';

/** Let go, `[-]`: struck through wherever it is shown, and owed by nobody. */
export const isSkipped = (task: Task): boolean => task.status === 'cancelled';

/**
 * How many of `tasks` are done, skipped and still open. Pure; every count of
 * a day's tasks (Today's summary, the week bars, the evening review) is this.
 */
export function tally(tasks: Task[]): { done: number; skipped: number; open: number } {
	return {
		done: tasks.filter(isDone).length,
		skipped: tasks.filter(isSkipped).length,
		open: tasks.filter(isOpen).length
	};
}

/**
 * Order of work on a screen: most urgent quadrant first, then the soonest due
 * date, then where the line lives, so the order is stable between loads.
 * Tasks without a quadrant or a due date sort last within their group.
 *
 * Display order only. Nothing here reorders a file.
 */
export function compareTasks(a: Task, b: Task): number {
	const byQuadrant = (a.quadrant ?? 9) - (b.quadrant ?? 9);
	if (byQuadrant !== 0) return byQuadrant;
	const byDue = (a.due ?? '~').localeCompare(b.due ?? '~');
	if (byDue !== 0) return byDue;
	return a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path);
}

/** Minutes a block occupies, treating a backwards range as crossing midnight. */
export function taskMinutes(task: Task): number {
	if (task.startMin === null || task.endMin === null) return 0;
	const span = task.endMin - task.startMin;
	return span < 0 ? span + 1440 : span;
}

const INLINE = [
	// Wikilinks show their alias, or the note name.
	[/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_m: string, target: string, alias?: string) => alias ?? target],
	// Markdown links show their label.
	[/\[([^\]]+)\]\([^)]*\)/g, '$1'],
	[/\*\*([^*]+)\*\*/g, '$1'],
	[/__([^_]+)__/g, '$1'],
	[/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1'],
	// Underscore emphasis only outside a word, so snake_case survives.
	[/(?<![\w_])_([^_]+)_(?![\w_])/g, '$1'],
	[/`([^`]+)`/g, '$1'],
	[/==([^=]+)==/g, '$1'],
	[/~~([^~]+)~~/g, '$1']
] as const;

/**
 * Task text with inline markdown reduced to the words it renders as.
 *
 * Needed because this vault's notes use bold and inline code inside task
 * lines, and a list showing `**Indexing:**` reads worse than the raw
 * file does. The stored text is untouched; this is display only.
 */
export function displayText(text: string): string {
	let out = text;
	for (const [pattern, replacement] of INLINE) {
		out = out.replace(pattern, replacement as never);
	}
	return out.replace(/\s+/g, ' ').trim();
}

/**
 * Task text reduced to something two spellings of the same work agree on:
 * the rendered words, lower case, with everything that is not a letter, a
 * digit or a space taken out.
 *
 * The one place two task lines are judged to be about the same thing. A time
 * log line records what was done rather than which line it came from, and a
 * workspace card the day already plans is the same work written twice, so
 * both questions are asked with this key. Deliberately blunt: it is used to
 * match or to skip, never to write.
 */
export function matchKey(text: string): string {
	return displayText(text)
		.toLowerCase()
		.replace(/[^a-z0-9 ]+/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** What the card drawer shows about one task: the line, and everything around it. */
export interface CardContext {
	task: Task;
	/** The task's indented sub-bullets, as written. Read-only context. */
	block: string[];
	/** Title of the note the task lives in. */
	title: string;
	/** The workspace the task belongs to now, by tag, folder or alias. */
	workspace: { slug: string; name: string; color: string } | null;
	/** Every workspace, with the tag that puts a task in it. */
	workspaces: Array<{ slug: string; name: string; color: string; tag: string }>;
}
