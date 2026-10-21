import { error, text } from '@sveltejs/kit';
import { hub } from '$server/hub';
import type { RequestHandler } from './$types';

/**
 * Serve a graph's `graph.html`, sandboxed.
 *
 * Only that one file of the graph's own folder is ever served, whatever the
 * URL. The CSP is `sandbox allow-scripts` with no `allow-same-origin`, so the
 * page's script can run but can never read cookies, storage or anything from
 * this origin.
 */
export const GET: RequestHandler = async ({ params }) => {
	const { vault, graphs } = await hub();
	const graph = (await graphs()).find((g) => g.slug === params.slug);
	if (!graph) error(404, 'No such graph');
	const note = await vault.read(`${graph.dir}/graph.html`);
	if (!note.exists) error(404, 'No such page');
	return text(note.content, {
		headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': 'sandbox allow-scripts' }
	});
};
