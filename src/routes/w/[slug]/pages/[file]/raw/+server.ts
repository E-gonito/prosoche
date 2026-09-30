import { error, text } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { homeFolder } from '$server/workspaces';
import type { RequestHandler } from './$types';

/**
 * Serve one of a workspace's custom HTML pages, sandboxed.
 *
 * `params.file` must be a bare file name — no `/`, no `..` — and must be one
 * the vault actually lists inside `<home>/Pages/`; `Vault.files` only ever
 * looks directly inside that one folder, so this can serve nothing else in
 * the vault, private or not. The response carries a strict sandbox CSP with
 * no `allow-same-origin`, so a page's own script can run but can never read
 * cookies, storage or anything from this origin.
 */
export const GET: RequestHandler = async ({ params }) => {
	const { file } = params;
	if (!file || file.includes('/') || file.includes('\\') || !/\.html?$/i.test(file)) error(404, 'No such page');

	const { vault, workspace: find } = await hub();
	const workspace = await find(params.slug);
	if (!workspace) error(404, 'No such workspace');

	const folder = `${homeFolder(workspace)}/Pages`;
	const names = await vault.files(folder, 'html');
	if (!names.includes(file)) error(404, 'No such page');

	const note = await vault.read(`${folder}/${file}`);
	if (!note.exists) error(404, 'No such page');

	return text(note.content, {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'content-security-policy': 'sandbox allow-scripts'
		}
	});
};
