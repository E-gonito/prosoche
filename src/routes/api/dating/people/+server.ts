import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { addDatingPerson, STAGES, type Stage } from '$server/dating';
import type { RequestHandler } from './$types';

const REFUSED = {
	'no-name': 'That is not a name a note can be filed under.',
	exists: 'There is already a note for that name.'
} as const;

function stage(value: unknown): Stage | undefined {
	return typeof value === 'string' && (STAGES as readonly string[]).includes(value) ? (value as Stage) : undefined;
}

/** Create a new dating person's note. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		name?: string;
		app?: string;
		age?: string;
		place?: string;
		job?: string;
		stage?: string;
		notes?: string;
	};
	if (!body.name) return json({ error: 'name is required' }, { status: 400 });

	const { vault, ready } = hub();
	await ready;

	const result = await addDatingPerson(vault, {
		name: body.name,
		app: body.app,
		age: body.age,
		place: body.place,
		job: body.job,
		stage: stage(body.stage),
		notes: body.notes
	});
	if (result.ok) return json({ ok: true, path: result.path });
	return json({ error: REFUSED[result.reason] }, { status: result.reason === 'exists' ? 409 : 400 });
};
