import { logContact } from '$server/people';
import { refuse, route, str } from '../route';

/**
 * Append one line to a person's log, `{ name, text }`, creating their note if
 * nobody has written about them before. Answers `{ day, created }`.
 *
 * A JSON endpoint rather than a form action, and that is the whole point:
 * SvelteKit refuses cross-site form posts and adapter-node cannot tell what
 * its own origin is unless `ORIGIN` is set, so a form action here once
 * answered every log line with a 403. One way to write means one thing to
 * get right. Never rewrites an existing line: `logContact` appends.
 */
export const POST = route(
	async ({ body, hub }) => {
		const name = str(body.name);
		return name ? logContact(hub.vault, name, str(body.text) ?? '') : refuse('invalid', 'name is required');
	},
	{ 'no-text': 'Write what you talked about first.' }
);
