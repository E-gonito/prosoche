import { createSubject } from '$server/study/subjects';
import { route, str, strings } from '../../route';

/**
 * Create a Study subject, `{ name, folders }`: a workspace file with
 * `template: study`, homed at `Study/<name>`, with `folders` (a list, or
 * comma separated) as reference folders. Answers `{ subject }`; a taken name
 * is a 409 with a sentence to show beside the form. Nothing is overwritten.
 */
export const POST = route(async ({ body, hub }) => {
	const extraFolders = strings(body.folders) ?? (str(body.folders) ?? '').split(',');
	return createSubject(hub.vault, await hub.workspaces(), { name: str(body.name) ?? '', extraFolders });
});
