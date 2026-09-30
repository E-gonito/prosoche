import { createSubject, deleteSubject, editSubject, subjectOf } from '$server/study/subjects';
import { noSubject, route, str, strings } from '../../route';

/**
 * Create a Study subject, `{ name, folders }`: a file in `_hub/subjects/`,
 * homed at `Study/<name>`, with `folders` (a list, or comma separated) as
 * reference folders. Answers `{ subject }`; a taken name is a 409 with a
 * sentence to show beside the form. Nothing is overwritten.
 */
export const POST = route(async ({ body, hub }) => {
	const extraFolders = strings(body.folders) ?? (str(body.folders) ?? '').split(',');
	return createSubject(hub.vault, { name: str(body.name) ?? '', extraFolders });
});

/**
 * Edit a subject's file, `{ subject, name?, color?, tag?, description?, folders? }`:
 * each field sent is written, and a field left out is left alone (see
 * `editSubject`). `folders` is every folder wanted after the home. Answers
 * `{ folders }`, the subject's folders as now written, home first.
 */
export const PATCH = route(async ({ body, hub }) => {
	const subject = subjectOf(await hub.subjects(), body.subject);
	if (!subject) return noSubject();
	const result = await editSubject(hub.vault, subject, {
		name: str(body.name),
		color: str(body.color),
		tag: str(body.tag),
		description: str(body.description),
		folders: strings(body.folders)
	});
	return result.ok ? { folders: subjectOf(await hub.subjects(), subject.slug)?.scope.folders ?? [] } : result;
});

/**
 * Delete a subject's file, `{ subject }`. Its folders, goals, reading list,
 * sessions and cards are untouched (see `deleteSubject`).
 */
export const DELETE = route(async ({ body, hub }) => {
	const result = await deleteSubject(hub.vault, str(body.subject) ?? '');
	return result.ok ? result : noSubject();
});
