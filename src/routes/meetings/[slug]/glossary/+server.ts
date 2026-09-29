import { redirect } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { glossaries } from '$server/glossary';
import type { RequestHandler } from './$types';

/**
 * The notebook's glossary tab moved to its own module, and glossaries no
 * longer belong to a workspace. An old link goes to the glossary the
 * workspace points at with `glossary:`, or to the list when it points at
 * none. An endpoint rather than a page, so the notebook's layout never runs
 * for it.
 */
export const GET: RequestHandler = async ({ params }) => {
	const { vault, ready, workspaces } = hub();
	await ready;
	const found = (await glossaries(vault, await workspaces())).find((g) => g.linked.some((w) => w.slug === params.slug));
	redirect(308, found ? `/glossary/${found.slug}` : '/glossary');
};
