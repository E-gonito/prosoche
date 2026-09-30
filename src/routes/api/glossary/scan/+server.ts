import { findGlossary } from '$server/glossary';
import { draftScan } from '$server/ai/glossary-drafts';
import { refuse, route, str } from '../../route';

/**
 * Draft one batch of a glossary's scan for new terms: `{ glossary, paths,
 * found }`, the glossary by slug, the batch's notes, and the terms earlier
 * batches found. Answers with the batch's candidates and those left out; a
 * run that was over budget or refused is a 200 with its problem, an answer
 * to show. Never writes a note: the terms a person keeps are written by
 * `/api/glossary`'s `add-scanned`. 404 for an unknown glossary.
 */
export const POST = route<{ glossary: string; paths: unknown; found: unknown }>(async ({ body, hub: { vault, workspaces } }) => {
	const glossary = await findGlossary(vault, await workspaces(), str(body.glossary) ?? '');
	return glossary ? draftScan(vault, glossary, { paths: body.paths, found: body.found }) : refuse('not-found', 'No such glossary.');
});
