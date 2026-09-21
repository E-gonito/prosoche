import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { logContact } from '$server/people';
import type { RequestHandler } from './$types';

/** What each refusal means in words, kept beside the codes it names. */
const REFUSED = {
	'no-name': 'That is not a name a note can be filed under.',
	'no-text': 'Write what you talked about first.',
	conflict: 'Their note changed on another device. Open it and try again.'
} as const;

/**
 * Append one line to a person's log, creating their note if nobody has
 * written about them before.
 *
 * A JSON endpoint rather than a form action, and that is the whole point.
 * Everything else in this app writes through `fetch` to a JSON route, and a
 * form action was the one exception — which is how nobody noticed that
 * SvelteKit refuses cross-site form posts and adapter-node cannot tell what
 * its own origin is unless `ORIGIN` is set. Every log line was answered with
 * a 403 on the real instance. One way to write means one thing to get right.
 *
 * A refusal is a status code with `{ error }`, as everywhere else here, so
 * the browser's one `post` helper turns it into the same `Result` the rest of
 * the app renders. Never rewrites an existing line: `logContact` appends, and
 * nothing here can make it do otherwise.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { name, text } = (await request.json().catch(() => ({}))) as { name?: string; text?: string };
	if (!name) return json({ error: 'name is required' }, { status: 400 });

	const { vault, ready } = hub();
	await ready;

	const result = await logContact(vault, name, text ?? '');
	if (result.ok) return json({ logged: result.day, created: result.created });
	return json({ error: REFUSED[result.reason] }, { status: result.reason === 'conflict' ? 409 : 400 });
};
