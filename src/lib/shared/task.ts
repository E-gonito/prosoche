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

/** True when the task carries `tag` exactly, or a tag nested under it. */
export function hasTag(task: Task, tag: string): boolean {
	return task.tags.some((t) => t === tag || t.startsWith(`${tag}/`));
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

export const isDone = (task: Task): boolean => task.status === 'done' || task.status === 'cancelled';

export const isOpen = (task: Task): boolean => !isDone(task);

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
