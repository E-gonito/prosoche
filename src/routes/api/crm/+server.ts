import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { createContact, updateContact, type ContactChange } from '$server/crm';
import type { RequestHandler } from './$types';

/** What each refusal means in words, and the status it answers with. */
const REFUSED = {
	'bad-name': [400, 'That name cannot be a file name. Leave out / \\ : * ? " < > | # ^ [ ] and a leading or trailing dot.'],
	exists: [409, 'There is already a contact with that name.'],
	private: [403, 'This workspace lives under Private/, and the CRM never writes there.'],
	missing: [404, 'There is no contact with that name.'],
	conflict: [409, 'This contact changed on another device. Reloading.'],
	'no-text': [400, 'Write what happened first.'],
	'bad-day': [400, 'That is not a date.']
} as const;

async function workspaceNamed(slug: unknown) {
	const { vault, ready, workspaces } = hub();
	await ready;
	const workspace = (await workspaces()).find((w) => w.slug === slug);
	return { vault, workspace };
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * Create a contact in a workspace's CRM. Answers 201 with the contact's
 * name, which may differ from what was typed only in its spacing.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	if (!str(body.name)) return json({ error: 'A contact needs a name.' }, { status: 400 });

	const { vault, workspace } = await workspaceNamed(body.workspace);
	if (!workspace) return json({ error: `There is no workspace called "${body.workspace}".` }, { status: 404 });

	const links = Array.isArray(body.links) ? body.links.filter((l): l is string => typeof l === 'string') : undefined;
	const result = await createContact(vault, workspace, str(body.name)!, {
		kind: str(body.kind),
		company: str(body.company),
		role: str(body.role),
		email: str(body.email),
		phone: str(body.phone),
		links,
		notes: str(body.notes)
	});
	if (result.ok) return json({ name: result.contact.name, hash: result.contact.hash }, { status: 201 });
	const [status, error] = REFUSED[result.reason];
	return json({ error }, { status });
};

/**
 * Change a contact: `fields` to set or clear, and or one history `entry`.
 * `expectedHash` is the hash the page loaded; a note that changed since is
 * a 409 and nothing is written. Answers with the note's new hash.
 */
export const PATCH: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	if (!str(body.name) || !str(body.expectedHash)) return json({ error: 'name and expectedHash are required' }, { status: 400 });

	const { vault, workspace } = await workspaceNamed(body.workspace);
	if (!workspace) return json({ error: `There is no workspace called "${body.workspace}".` }, { status: 404 });

	const change: ContactChange = {
		fields: typeof body.fields === 'object' && body.fields !== null ? (body.fields as ContactChange['fields']) : undefined,
		entry: typeof body.entry === 'object' && body.entry !== null ? (body.entry as ContactChange['entry']) : undefined
	};
	const result = await updateContact(vault, workspace, str(body.name)!, str(body.expectedHash)!, change);
	if (result.ok) return json({ hash: result.contact.hash });
	const [status, error] = REFUSED[result.reason];
	return json({ error }, { status });
};
