/**
 * The browser's side of the JSON API: one call, `api`, and the two named
 * functions that do more than send, because they locate a task.
 *
 * Every call returns a discriminated result rather than throwing, so callers
 * handle a conflict the same way they handle success: by rendering it. A
 * network failure is reported as an offline result, because a planner on a
 * phone will lose its connection and must not lose the user's intent.
 *
 * Designed twice. (a) This: one generic `api<T>(path, body?, { method })`,
 * the answer's type named at the call. (b) A table of every endpoint's body
 * and answer types, with `api` typed from it. (a) won: the routes' answers
 * are their domain modules' results passed straight through, so (b)'s table
 * would be a second copy of types that already exist, kept in step by hand.
 */

import type { Task, TaskStatus } from '$lib/shared/task';

/**
 * An answer. A failure carries the server's sentence as `message` and its
 * whole answer as `body`, for the routes that send more than a sentence
 * back (the board or reading list as it now is, the other version of a note).
 */
export type Result<T> =
	| { ok: true; value: T }
	| { ok: false; kind: 'conflict' | 'error' | 'offline'; message: string; body: Record<string, any> };

/**
 * Send one request to `path` and read the JSON answer.
 *
 * Inputs: the path (with any query string), a body to send as JSON, the
 * method, POST when there is a body and GET when there is none, and a
 * `signal` that abandons the request. Output: the answer as `T` for a 2xx;
 * otherwise `conflict` for a 409 and `error` for any other status, with the
 * server's own sentence, which is written to be shown to a person; `offline`
 * when there was no answer at all, an abandoned request included. Never
 * throws.
 */
export async function api<T = Record<string, never>>(
	path: string,
	body?: unknown,
	{ method = body === undefined ? 'GET' : 'POST', signal }: { method?: string; signal?: AbortSignal } = {}
): Promise<Result<T>> {
	let res: Response;
	try {
		res = await fetch(path, {
			method,
			signal,
			headers: body === undefined ? undefined : { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	} catch {
		return { ok: false, kind: 'offline', message: 'No connection. Nothing was changed.', body: {} };
	}
	const parsed = await res.json().catch(() => ({}));
	if (res.ok) return { ok: true, value: parsed as T };
	return {
		ok: false,
		kind: res.status === 409 ? 'conflict' : 'error',
		message: typeof parsed.error === 'string' ? parsed.error : `Request failed (${res.status})`,
		body: parsed
	};
}

export interface TaskEdit {
	status?: TaskStatus;
	time?: { start: string; end: string } | null;
	quadrant?: number | null;
	/** New words for the task. An empty string is ignored by the rewriter. */
	text?: string;
	due?: string | null;
	id?: string | null;
	blockedBy?: string[] | null;
	/** Tags to add or remove, without `#`, e.g. `pin`, `col/review`. */
	addTags?: string[];
	removeTags?: string[];
}

/** Which line a task is, and the line as the browser last saw it: the conflict token. */
function locate(task: Task) {
	return { path: task.path, line: task.line, expectedRaw: task.raw };
}

/** Apply an edit to one task line. Returns the task as now written. */
export async function editTask(task: Task, edit: TaskEdit): Promise<Result<Task>> {
	const result = await api<{ task: Task }>('/api/task', { ...locate(task), ...edit });
	return result.ok ? { ok: true, value: result.value.task } : result;
}

/**
 * Plan a card from another note onto a day, as a block in the day's note that
 * links back to it. The card's own line is not touched. Returns the new block.
 */
export async function planOnDay(day: string, task: Task, time?: { startMin: number; endMin: number }): Promise<Result<Task>> {
	const result = await api<{ task: Task }>(`/api/day/${day}/plan`, { ...locate(task), ...time });
	return result.ok ? { ok: true, value: result.value.task } : result;
}

/**
 * Write a workspace's (or study subject's) changed details: `kind` is its
 * `template:`. Only the fields given are sent, and the server writes only
 * those. Returns the server's result; never reloads the page.
 */
export async function saveWorkspace(
	slug: string,
	changed: { name?: string; description?: string; color?: string; tag?: string; kind?: string }
): Promise<Result<unknown>> {
	const { kind, ...rest } = changed;
	return api('/api/workspace', { slug, ...rest, ...(kind === undefined ? {} : { template: kind }) }, { method: 'PATCH' });
}
