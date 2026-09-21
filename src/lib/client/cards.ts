/**
 * The browser's side of cards and workspaces.
 *
 * Separate from `api.ts` only because that file is the day's API and this one
 * is the board's; the contract is the same one — every call returns a
 * `Result`, never throws, and reports a lost connection as such, because a
 * board used on a phone will lose the network and must not lose the intent.
 *
 * Moving a card lives here too, so the browser and the server compute the
 * same edit from the same function: this asks `$lib/shared/board` what the
 * move means and sends it through the guarded task endpoint, which refuses a
 * line that changed underneath.
 */

import { editTask, type Result } from './api';
import { columnFor, moveEdit, type Column } from '$lib/shared/board';
import type { Task } from '$lib/shared/task';

export type { Result };

/** What the drawer shows about one card: the line, and everything around it. */
export interface CardContext {
	task: Task;
	/** The task's indented sub-bullets, as written. Read-only context. */
	block: string[];
	/** Title of the note the card lives in. */
	title: string;
	workspace: { slug: string; name: string; color: string } | null;
}

export interface NewCard {
	/** Slug of the workspace whose deck the card is appended to. */
	workspace: string;
	text: string;
	quadrant?: number | null;
	/** Column key, so a card made in a named column lands there. */
	column?: string | null;
}

export interface NewWorkspace {
	name: string;
	color?: string;
	folders?: string[];
	template?: string;
}

/**
 * Move `task` into `column`, in the vault.
 *
 * Returns the task unchanged, without a request, when it is already in that
 * column: a drag that ends where it started is not an edit, and sending one
 * would put a pointless commit in the vault's history.
 */
export async function moveCard(task: Task, column: Column, columns: Column[]): Promise<Result<Task>> {
	if (columnFor(task, columns).key === column.key) return { ok: true, value: task };
	return editTask(task, moveEdit(task, column));
}

/** The line, its sub-bullets and its workspace. A missing card is an error. */
export async function cardContext(path: string, line: number): Promise<Result<CardContext>> {
	const query = new URLSearchParams({ path, line: String(line) });
	return send(`/api/card?${query}`, { method: 'GET' }, (body) => body as CardContext);
}

/** Append a card to the workspace's deck. Returns the task it wrote. */
export async function createCard(card: NewCard): Promise<Result<Task>> {
	return send('/api/card', json(card), (body) => body.task as Task);
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
