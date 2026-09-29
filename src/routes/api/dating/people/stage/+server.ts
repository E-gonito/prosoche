import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { setStage, STAGES, type Stage } from '$server/dating';
import type { RequestHandler } from './$types';

const REFUSED = {
	'no-note': 'There is no note for that name yet.',
	conflict: 'Their note changed on another device. Reloading.'
} as const;

/** Rewrite a person's frontmatter `stage:` line alone. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { name?: string; stage?: string };
	if (!body.name) return json({ error: 'name is required' }, { status: 400 });
	if (!(STAGES as readonly string[]).includes(body.stage ?? '')) {
		return json({ error: `stage must be one of ${STAGES.join(', ')}` }, { status: 400 });
	}

	const { vault, ready } = hub();
	await ready;

	const result = await setStage(vault, body.name, body.stage as Stage);
	if (result.ok) return json({ ok: true });
	return json({ error: REFUSED[result.reason] }, { status: result.reason === 'conflict' ? 409 : 404 });
};
