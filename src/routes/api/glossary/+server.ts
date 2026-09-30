import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { addTerm, createGlossary, deleteGlossary, deleteTerm, editTerm, findGlossary, renameGlossary, setGlossaryStudy } from '$server/glossary';
import { syncGlossaryCards } from '$server/study/glossary-cards';
import type { Written } from '$server/rewrite';
import type { RequestHandler } from './$types';

interface Body {
	action?: 'create-glossary' | 'rename-glossary' | 'delete-glossary' | 'add' | 'edit' | 'delete' | 'set-study';
	/** Every action but create: the glossary, by slug. */
	glossary?: string;
	/** create and rename: the glossary's new name. */
	name?: string;
	/** add: the new term. edit and delete: the term as it is now. */
	term?: string;
	/** edit: the fields to change; absent ones are left alone. */
	change?: { term?: unknown; category?: unknown; definition?: unknown; relevance?: unknown };
	category?: string | null;
	source?: string | null;
	/** set-study: the study subject's slug, or '' to unlink. */
	study?: unknown;
}

const STATUS: Record<Exclude<Written, { ok: true }>['reason'], number> = { conflict: 409, 'not-found': 404, invalid: 400 };

/**
 * The glossaries' writes, each one a user's click: create, rename or delete
 * a glossary; add, edit or delete a term in one; or link it to a study
 * subject. Translation only; `$server/glossary` decides what is written.
 *
 * After any of these writes to a glossary, its cards are brought in step
 * (`syncGlossaryCards`) before the response, so the page reloads onto them;
 * a rename moves them to the new name's folder first. A glossary linked to
 * no subject makes that a read and nothing more.
 *
 * Responds with `{ ok: true, path }`, or
 * `{ ok: false, reason, message }` with 409 for a clash, 404 for an unknown
 * glossary and 400 for a bad request.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	const { vault, ready, workspaces } = hub();
	await ready;

	const reply = (result: Written) => json(result, { status: result.ok ? 200 : STATUS[result.reason] });
	if (body.action === 'create-glossary') return reply(await createGlossary(vault, String(body.name ?? '')));

	const all = await workspaces();
	const glossary = await findGlossary(vault, all, String(body.glossary ?? ''));
	if (!glossary) return json({ ok: false, reason: 'not-found', message: 'No such glossary.' }, { status: 404 });
	const synced = async (result: Written, opts: { renamedFrom?: string } = {}) => {
		if (result.ok) await syncGlossaryCards(vault, all, result.path, opts);
		return reply(result);
	};

	const text = (value: unknown) => (typeof value === 'string' ? value : null);
	switch (body.action) {
		case 'rename-glossary':
			return synced(await renameGlossary(vault, glossary, String(body.name ?? '')), { renamedFrom: glossary.name });
		case 'delete-glossary':
			return reply(await deleteGlossary(vault, glossary));
		case 'add':
			return synced(
				await addTerm(vault, glossary.path, {
					term: String(body.term ?? ''),
					category: text(body.category),
					source: text(body.source)
				})
			);
		case 'edit': {
			const c = body.change ?? {};
			const optional = (value: unknown) => (typeof value === 'string' ? value : undefined);
			return synced(
				await editTerm(vault, glossary.path, String(body.term ?? ''), {
					term: optional(c.term),
					category: optional(c.category),
					definition: optional(c.definition),
					relevance: optional(c.relevance)
				})
			);
		}
		case 'delete':
			return synced(await deleteTerm(vault, glossary.path, String(body.term ?? '')));
		case 'set-study':
			return synced(await setGlossaryStudy(vault, glossary, all, body.study));
		default:
			return json({ ok: false, reason: 'invalid', message: 'Unknown action.' }, { status: 400 });
	}
};
