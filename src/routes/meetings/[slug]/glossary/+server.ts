import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * The notebook's glossary tab moved to its own module. An endpoint rather
 * than a page, so the notebook's layout never runs for it and an old link
 * to a workspace without meetings still lands on its glossary.
 */
export const GET: RequestHandler = ({ params }) => {
	redirect(308, `/glossary/${encodeURIComponent(params.slug)}`);
};
