/**
 * The one shape every JSON route under `/api` has.
 *
 * A handler takes the parsed body, the URL, the route params and the ready
 * hub, and returns what the domain module answered. It never builds a
 * `Response`: this file turns an answer into JSON and a refusal
 * (`{ ok: false, reason }`) into a status and a sentence, from one table.
 *
 * Designed twice. (a) This: one wrapper and one reason-to-status table, with
 * a route's own words for the reasons it knows better. (b) A declarative
 * spec per route (body schema, method, domain call, status map) interpreted
 * by a router. (a) won: the domain modules already return `{ ok, reason }`,
 * so the wrapper only has to read it, and (b)'s schema layer would restate
 * each module's own input checks in a second language.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { hub, type Hub } from '$server/hub';
import { PathOutsideVaultError } from '$server/vault/paths';

/** What a handler is given. `body` is untrusted: every field may be missing or the wrong type. */
export interface Call<B> {
	body: Partial<B>;
	url: URL;
	params: Record<string, string>;
	hub: Hub;
}

/** A refusal: why, and the sentence to show when the reason's default will not do. */
export interface Refusal {
	ok: false;
	reason: string;
	message?: string;
}

/** The one sentence for "someone else wrote first". Nothing was written. */
const CONFLICT = 'That changed somewhere else, so nothing was written. Reload and try again.';

/** Every reason a domain module refuses with, the status it answers and the default words. */
const REASONS: Record<string, [status: number, message: string]> = {
	invalid: [400, 'That request is missing something.'],
	'no-name': [400, 'That is not a name a note can be filed under.'],
	'bad-name': [400, 'That name cannot be a file name. Leave out / \\ : * ? " < > | # ^ [ ] and a leading or trailing dot.'],
	'no-text': [400, 'Write something first.'],
	'bad-day': [400, 'That is not a date.'],
	'no-column': [400, 'The board has no column to file it into. Add one on the Overview.'],
	private: [403, 'That lives under Private/, which this never writes.'],
	'not-found': [404, 'That is not there any more.'],
	missing: [404, 'That is not there any more.'],
	'no-note': [404, 'That note is not there.'],
	'no-day': [404, 'That day has no note yet.'],
	'no-card': [404, 'That card is not there any more.'],
	exists: [409, 'There is already one with that name.'],
	conflict: [409, CONFLICT],
	'line-changed': [409, CONFLICT],
	changed: [409, CONFLICT]
};

/** A refusal with `reason`, and a sentence when the table's is not the right one. Pure. */
export function refuse(reason: string, message?: string): Refusal {
	return { ok: false, reason, message };
}

/**
 * Wrap a handler as a SvelteKit `RequestHandler`.
 *
 * Inputs: the handler, and `words`, sentences for reasons this route can say
 * better than the table. Output: a handler that parses a JSON body (anything
 * unparseable reads as `{}`), awaits the hub, runs `handler`, and answers
 * 200 with what it returned; or, for `{ ok: false, reason }`, the reason's
 * status with the rest of the answer and `error`, the sentence to show. A
 * path outside the vault is a 400. Never answers a refusal with 200, and
 * never swallows any other exception.
 */
export function route<B = Record<string, unknown>>(
	handler: (call: Call<B>) => Promise<object> | object,
	words: Record<string, string> = {}
): RequestHandler {
	return async ({ request, url, params }) => {
		const parsed = request.method === 'GET' ? {} : await request.json().catch(() => ({}));
		const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
		let answer: object;
		try {
			answer = await handler({ body, url, params: params as Record<string, string>, hub: await hub() });
		} catch (e) {
			if (e instanceof PathOutsideVaultError) answer = refuse('invalid', 'That is not a note.');
			else throw e;
		}
		if (!isRefusal(answer)) return json(answer);
		const { message, ...rest } = answer;
		const [status, fallback] = REASONS[answer.reason] ?? [422, 'That did not work.'];
		return json({ ...rest, error: message ?? words[answer.reason] ?? fallback }, { status });
	};
}

function isRefusal(answer: object): answer is Refusal {
	return (answer as { ok?: unknown }).ok === false && typeof (answer as { reason?: unknown }).reason === 'string';
}

/** `value` if it is a string, else undefined. For reading an untrusted body. Pure. */
export function str(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/** The strings in `value` if it is an array, else undefined. For reading an untrusted body. Pure. */
export function strings(value: unknown): string[] | undefined {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
}

/** The refusal for a workspace slug that names none. Pure. */
export function noWorkspace(slug: unknown): Refusal {
	return refuse('not-found', `There is no workspace called "${String(slug ?? '')}".`);
}

/** The refusal for a study subject slug that names none. Pure. */
export function noSubject(): Refusal {
	return refuse('not-found', 'There is no such subject.');
}
