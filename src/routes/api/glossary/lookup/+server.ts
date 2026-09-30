import { findGlossary } from '$server/glossary';
import { draftLookups } from '$server/ai/glossary-drafts';
import { refuse, route, str, strings } from '../../route';

/**
 * Draft definitions for terms of one glossary: `{ glossary, terms? }`, the
 * glossary by slug and the terms to look up (every one waiting when absent).
 * Answers with a `DraftResult`, whose proposal goes to `/api/ai/proposal` to
 * be validated and applied; a run that was over budget or refused is a 200
 * with its problem, an answer to show. Never writes a note. 404 for an
 * unknown glossary.
 */
export const POST = route<{ glossary: string; terms: string[] }>(async ({ body, hub: { vault, workspaces } }) => {
	const glossary = await findGlossary(vault, await workspaces(), str(body.glossary) ?? '');
	return glossary ? draftLookups(vault, glossary, strings(body.terms) ?? null) : refuse('not-found', 'No such glossary.');
});
