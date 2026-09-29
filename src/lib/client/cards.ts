/**
 * The browser's side of the card drawer and of workspaces.
 *
 * Separate from `api.ts` only because that file is the day's API; the
 * contract is the same one — every call returns a `Result`, never throws,
 * and reports a lost connection as such, because a page used on a phone
 * will lose the network and must not lose the intent.
 */

import type { Result } from './api';
import type { Task } from '$lib/shared/task';

export type { Result };

/** What the drawer shows about one task: the line, and everything around it. */
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

export interface NewWorkspace {
	name: string;
	color?: string;
	folders?: string[];
}

/** The line, its sub-bullets and its workspace. A missing task is an error. */
export async function cardContext(path: string, line: number): Promise<Result<CardContext>> {
	const query = new URLSearchParams({ path, line: String(line) });
	return send(`/api/card?${query}`, { method: 'GET' }, (body) => body as CardContext);
}

/** Write a new workspace definition. Returns its slug for the redirect. */
export async function createWorkspace(spec: NewWorkspace): Promise<Result<{ slug: string; name: string }>> {
	return send('/api/workspace', json(spec), (body) => body.workspace as { slug: string; name: string });
}

function json(body: unknown): RequestInit {
	return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

/**
 * One request, one result. A 4xx carries the server's own sentence, which is
 * written to be shown to a person, so the UI never has to invent wording for
 * a case the server already explained.
 */
async function send<T>(url: string, init: RequestInit, pick: (body: any) => T): Promise<Result<T>> {
	try {
		const res = await fetch(url, init);
		const body = await res.json().catch(() => ({}));
		if (res.ok) return { ok: true, value: pick(body) };
		if (res.status === 409) return { ok: false, kind: 'conflict', message: body.error ?? 'That changed on another device.' };
		return { ok: false, kind: 'error', message: body.error ?? `Request failed (${res.status})` };
	} catch {
		return { ok: false, kind: 'offline', message: 'No connection.' };
	}
}
