import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { createSubject } from '$server/study/subjects';
import type { RequestHandler } from './$types';

interface Body {
	name?: string;
	/** Reference folders beyond the home, as a list or comma separated. */
	folders?: string[] | string;
}

/**
 * Create a Study subject: a workspace file with `template: study`, homed at
 * `Study/<name>`. Answers 201 with the subject's slug; 400 for no name, 409
 * for a name that is taken, each with a sentence to show beside the form.
 * Nothing is overwritten.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	const { vault, ready, workspaces } = hub();
	await ready;

	const list = Array.isArray(body.folders) ? body.folders : (body.folders ?? '').split(',');
	const result = await createSubject(vault, await workspaces(), {
		name: typeof body.name === 'string' ? body.name : '',
		extraFolders: list.filter((f): f is string => typeof f === 'string')
	});
	if (result.ok) return json({ ok: true, slug: result.subject.slug }, { status: 201 });
	return json({ error: result.message }, { status: result.reason === 'no-name' ? 400 : 409 });
};
