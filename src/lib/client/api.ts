/**
 * The browser's side of the JSON API.
 *
 * Every call returns a discriminated result rather than throwing, so callers
 * handle a conflict the same way they handle success: by rendering it. A
 * network failure is reported as an offline result, because a planner on a
 * phone will lose its connection and must not lose the user's intent.
 */

import type { Task, TaskStatus } from '$lib/shared/task';

export type { Task, TaskStatus };

export type Result<T> =
	| { ok: true; value: T }
	| { ok: false; kind: 'conflict'; message: string }
	| { ok: false; kind: 'offline' | 'error'; message: string };

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

/** Apply an edit to one task line. */
export async function editTask(task: Task, edit: TaskEdit): Promise<Result<Task>> {
	return post('/api/task', { path: task.path, line: task.line, expectedRaw: task.raw, ...edit }, (body) => body.task);
}

/**
 * Plan a card from another note onto a day, as a block in the day's note that
 * links back to it. The card's own line is not touched. Returns the new block.
 */
export async function planOnDay(
	day: string,
	task: Task,
	time?: { startMin: number; endMin: number }
): Promise<Result<Task>> {
	return post(
		`/api/day/${day}/plan`,
		{ path: task.path, line: task.line, expectedRaw: task.raw, ...time },
		(body) => body.task
	);
}

/** Append a line to the capture inbox, or to one workspace's own inbox. */
export async function captureText(text: string, workspace?: string): Promise<Result<{ path: string }>> {
	return post('/api/capture', { text, workspace }, (body) => ({ path: body.path }));
}

/**
 * Append one dated line to a person's log.
 *
 * Creates their note when this is the first thing written about them, which
 * is why the result says so: the page reports "created" differently from
 * "added a line to what was there".
 */
export async function logContact(
	name: string,
	text: string
): Promise<Result<{ logged: string; created: boolean }>> {
	return post('/api/person', { name, text }, (body) => ({
		logged: body.logged as string,
		created: Boolean(body.created)
	}));
}

/** A contact's details as the CRM forms send them. Links are one per item. */
export interface ContactDetails {
	kind?: string;
	company?: string;
	role?: string;
	email?: string;
	phone?: string;
	links?: string[];
}

/**
 * Create a contact in a workspace's CRM. Refused, with a message saying why,
 * for a name that cannot be a file name or that another contact already has.
 */
export async function createContact(
	workspace: string,
	name: string,
	details: ContactDetails & { notes?: string }
): Promise<Result<{ name: string }>> {
	return post('/api/crm', { workspace, name, ...details }, (body) => ({ name: body.name as string }));
}

/**
 * Change a contact: set or clear `fields` (an empty value clears), add one
 * history `entry`, or both. `expectedHash` is the hash the page loaded; a
 * contact changed since comes back as a conflict and nothing is written.
 */
export async function updateContact(
	workspace: string,
	name: string,
	expectedHash: string,
	change: { fields?: ContactDetails; entry?: { day: string; text: string } }
): Promise<Result<{ hash: string }>> {
	return post('/api/crm', { workspace, name, expectedHash, ...change }, (body) => ({ hash: body.hash as string }), 'PATCH');
}

/** Create today's note from the vault template. Idempotent. */
export async function createDay(day: string): Promise<Result<{ path: string }>> {
	return post(`/api/day/${day}`, {}, (body) => ({ path: body.path }));
}

/** Save a whole note. A conflict carries the other version. */
export async function saveNote(
	path: string,
	content: string,
	expectedHash: string
): Promise<Result<{ hash: string }> | { ok: false; kind: 'conflict'; message: string; current: string; currentHash: string }> {
	try {
		const res = await fetch('/api/note', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ path, content, expectedHash })
		});
		const body = await res.json().catch(() => ({}));
		if (res.ok) return { ok: true, value: { hash: body.hash } };
		if (res.status === 409) {
			return {
				ok: false,
				kind: 'conflict',
				message: 'This note changed on another device.',
				current: body.current ?? '',
				currentHash: body.currentHash ?? ''
			};
		}
		return { ok: false, kind: 'error', message: body.error ?? `Save failed (${res.status})` };
	} catch {
		return { ok: false, kind: 'offline', message: 'No connection. Your text is still here.' };
	}
}

async function post<T>(url: string, body: unknown, pick: (body: any) => T, method = 'POST'): Promise<Result<T>> {
	try {
		const res = await fetch(url, {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const parsed = await res.json().catch(() => ({}));
		if (res.ok) return { ok: true, value: pick(parsed) };
		if (res.status === 409) {
			return { ok: false, kind: 'conflict', message: parsed.error ?? 'That line changed on another device. Reloading.' };
		}
		return { ok: false, kind: 'error', message: parsed.error ?? `Request failed (${res.status})` };
	} catch {
		return { ok: false, kind: 'offline', message: 'No connection.' };
	}
}
