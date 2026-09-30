import { createContact, updateContact, type ContactChange } from '$server/crm';
import { noWorkspace, refuse, route, str, strings } from '../route';

/** The CRM's words for the reasons it shares with every other route. */
const WORDS = {
	exists: 'There is already a contact with that name.',
	private: 'This workspace lives under Private/, and the CRM never writes there.',
	missing: 'There is no contact with that name.',
	'no-text': 'Write what happened first.'
};

/**
 * Create a contact in a workspace's CRM: `{ workspace, name, ...details }`.
 * Answers `{ contact }`, whose name may differ from what was typed only in
 * its spacing.
 */
export const POST = route(async ({ body, hub }) => {
	const name = str(body.name);
	if (!name) return refuse('invalid', 'A contact needs a name.');
	const workspace = await hub.workspace(body.workspace);
	if (!workspace) return noWorkspace(body.workspace);
	return createContact(hub.vault, workspace, name, {
		kind: str(body.kind),
		company: str(body.company),
		role: str(body.role),
		email: str(body.email),
		phone: str(body.phone),
		links: strings(body.links),
		notes: str(body.notes)
	});
}, WORDS);

/**
 * Change a contact: `fields` to set or clear, and or one history `entry`.
 * `expectedHash` is the hash the page loaded; a note that changed since is a
 * 409 and nothing is written. Answers `{ contact }` with its new hash.
 */
export const PATCH = route(async ({ body, hub }) => {
	const name = str(body.name);
	const expectedHash = str(body.expectedHash);
	if (!name || !expectedHash) return refuse('invalid', 'name and expectedHash are required');
	const workspace = await hub.workspace(body.workspace);
	if (!workspace) return noWorkspace(body.workspace);
	const object = (value: unknown) => (typeof value === 'object' && value !== null ? value : undefined);
	const change: ContactChange = {
		fields: object(body.fields) as ContactChange['fields'],
		entry: object(body.entry) as ContactChange['entry']
	};
	return updateContact(hub.vault, workspace, name, expectedHash, change);
}, WORDS);
