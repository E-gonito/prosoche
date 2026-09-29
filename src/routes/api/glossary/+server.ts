import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { addTerm, deleteTerm, editTerm, startGlossary } from '$server/glossary';
import type { Written } from '$server/rewrite';
import type { RequestHandler } from './$types';

interface Body {
	action?: 'start' | 'add' | 'edit' | 'delete';
	/** The workspace whose glossary this is. */
	slug?: string;
	/** add: the new term. edit and delete: the term as it is now. */
	term?: string;
	/** edit: the fields to change; absent ones are left alone. */
	change?: { term?: unknown; category?: unknown; definition?: unknown; relevance?: unknown };
	category?: string | null;
	source?: string | null;
}

const STATUS: Record<Exclude<Written, { ok: true }>['reason'], number> = { conflict: 409, 'not-found': 404, invalid: 400 };

/**
 * A glossary's writes, each one a user's click: start a workspace's
 * glossary, or add, edit or delete a term. Translation only; `$server/glossary`
 * decides what is written.
 *
 * Responds with `{ ok: true, path }`, or `{ ok: false, reason, message }`
 * with 409 for a clash, 404 for an unknown workspace and 400 for a bad
 * request.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	const { vault, ready, workspaces } = hub();
	await ready;

	const reply = (result: Written) => json(result, { status: result.ok ? 200 : STATUS[result.reason] });
	const workspace = (await workspaces()).find((w) => w.slug === body.slug);
	if (!workspace) return json({ ok: false, reason: 'not-found', message: 'No such workspace.' }, { status: 404 });

	const text = (value: unknown) => (typeof value === 'string' ? value : null);
	switch (body.action) {
		case 'start':
			return reply(await startGlossary(vault, workspace));
		case 'add':
			return reply(
				await addTerm(vault, workspace, {
					term: String(body.term ?? ''),
					category: text(body.category),
					source: text(body.source)
				})
			);
		case 'edit': {
			const c = body.change ?? {};
			const optional = (value: unknown) => (typeof value === 'string' ? value : undefined);
			return reply(
				await editTerm(vault, workspace, String(body.term ?? ''), {
					term: optional(c.term),
					category: optional(c.category),
					definition: optional(c.definition),
					relevance: optional(c.relevance)
				})
			);
		}
		case 'delete':
			return reply(await deleteTerm(vault, workspace, String(body.term ?? '')));
		default:
			return json({ ok: false, reason: 'invalid', message: 'Unknown action.' }, { status: 400 });
	}
};
