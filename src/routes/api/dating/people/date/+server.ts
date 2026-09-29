import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { addDatingDate } from '$server/dating';
import { isDayKey } from '$server/daily';
import type { RequestHandler } from './$types';

const REFUSED = {
	'no-name': 'That is not a name a note can be filed under.',
	'no-text': 'Say what the date was first.',
	conflict: 'Their note changed on another device. Open it and try again.'
} as const;

/** Append one line to a person's `## Dates` log, creating their note if needed. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		name?: string;
		day?: string;
		text?: string;
		rating?: number | null;
		cost?: number | null;
		notes?: string;
	};
	if (!body.name) return json({ error: 'name is required' }, { status: 400 });

	const { vault, ready } = hub();
	await ready;

	const result = await addDatingDate(vault, body.name, {
		day: body.day && isDayKey(body.day) ? body.day : undefined,
		text: body.text ?? '',
		rating: body.rating ?? null,
		cost: body.cost ?? null,
		notes: body.notes
	});
	if (result.ok) return json({ ok: true, line: result.line });
	return json({ error: REFUSED[result.reason] }, { status: result.reason === 'conflict' ? 409 : 400 });
};
