import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { CONTACT_KINDS, readContact } from '$server/crm';
import { today } from '$server/daily';
import { renderNote } from '$server/render';
import type { PageServerLoad } from './$types';

/**
 * One contact: its details, its notes rendered with wikilinks resolved the
 * way Notes resolves them, and its history newest first. A name with no note
 * in this workspace's CRM folder is a 404; the list is one tab away.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { vault, index, workspace: find } = await hub();
	const workspace = (await find(params.slug))!;
	const contact = await readContact(vault, workspace, params.name);
	if (!contact) error(404, `There is no contact called "${params.name}" in ${workspace.name}.`);

	return {
		contact,
		html: contact.notes ? renderNote(index, contact.notes) : '',
		kinds: [...CONTACT_KINDS] as string[],
		today: today()
	};
};
