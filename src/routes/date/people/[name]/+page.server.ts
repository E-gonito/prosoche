import { hub } from '$server/hub';
import { loadDatingPerson, STAGES } from '$server/dating';
import { renderMarkdown } from '$server/render';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { vault } = await hub();

	const p = await loadDatingPerson(vault, params.name);
	return { ...p, stages: STAGES, html: p.body.trim() ? renderMarkdown(p.body) : '' };
};
