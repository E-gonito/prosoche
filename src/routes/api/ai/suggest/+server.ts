import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { draftLookups } from '$server/ai/glossary-drafts';
import { findGlossary } from '$server/glossary';
import type { RequestHandler } from './$types';

/**
 * The features that draft a change and stop: today, the glossary look-up.
 *
 * Each produces a `Proposal` that goes to `/api/ai/proposal` to be validated
 * and applied, and having one door in keeps that true. The `destinations` a
 * caller must pass to apply are returned alongside, since this is the code
 * that knows what each run is about and the browser should not be inventing
 * paths for the path policy to check.
 *
 * Responds 200 with a problem rather than an error status: a model that was
 * over budget, refused, or chose a path it was not offered is an answer to
 * show, not an exception for the browser to catch.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		feature?: string;
		/** glossary-lookup: which glossary, by slug, and which terms (all waiting when absent). */
		glossary?: string;
		terms?: string[];
	};
	const { vault, ready, workspaces } = hub();
	await ready;

	if (body.feature === 'glossary-lookup') {
		const glossary = await findGlossary(vault, await workspaces(), String(body.glossary ?? ''));
		if (!glossary) return json({ error: 'no such glossary' }, { status: 404 });
		const terms = Array.isArray(body.terms) ? body.terms.filter((t) => typeof t === 'string') : null;
		return json(await draftLookups(vault, glossary, terms));
	}

	return json({ error: 'unknown feature' }, { status: 400 });
};
