import { hub } from '$server/hub';
import { CONTACT_KINDS, listContacts } from '$server/crm';
import { today } from '$server/daily';
import type { PageServerLoad } from './$types';

/**
 * A workspace's CRM: every contact in `<home>/CRM/`, most recent interaction
 * first. The layout has already answered 404 for an unknown workspace.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { vault, ready, workspaces } = hub();
	await ready;

	const workspace = (await workspaces()).find((w) => w.slug === params.slug)!;
	return { contacts: await listContacts(vault, workspace), kinds: [...CONTACT_KINDS] as string[], today: today() };
};
