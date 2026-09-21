import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { setStatus } from '$server/study/resources';
import type { ResourceStatus } from '$lib/shared/study';
import type { RequestHandler } from './$types';

interface Body {
	path?: string;
	status?: ResourceStatus;
}

/**
 * Set a resource's status, which writes one `status:` line into its
 * frontmatter. Answers 422 for a status that is not one of the four, 404 for
 * a note that is not there, and 409 when the note changed while we were
 * writing. Never creates a note.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Body;
	if (!body.path || !body.status) return json({ error: 'path and status are required' }, { status: 400 });

	const { vault, index } = hub();
	const result = await setStatus(vault, index, body.path, body.status);
	if (result.ok) return json({ ok: true, resource: result.resource });

	const status = result.reason === 'no-note' ? 404 : result.reason === 'conflict' ? 409 : 422;
	return json({ error: result.reason }, { status });
};
