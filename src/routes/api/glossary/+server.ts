import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { today } from '$server/daily';
import { addScannedTerms, addTerm, createGlossary, deleteGlossary, deleteTerm, editTerm, findGlossary, renameGlossary, setGlossarySources, type ScanAdded } from '$server/glossary';
import type { Written } from '$server/rewrite';
import type { RequestHandler } from './$types';

interface Body {
	action?: 'create-glossary' | 'rename-glossary' | 'delete-glossary' | 'add' | 'edit' | 'delete' | 'set-sources' | 'add-scanned';
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
	/** set-sources: the folders the glossary is scanned from. */
	sources?: unknown;
	/** add-scanned: the entries a person kept, and whether the scan read every note it meant to. */
	entries?: unknown;
	complete?: unknown;
}

const STATUS: Record<Exclude<Written, { ok: true }>['reason'], number> = { conflict: 409, 'not-found': 404, invalid: 400 };

/**
 * The glossaries' writes, each one a user's click: create, rename or delete
 * a glossary; add, edit or delete a term in one; set the folders it is
 * scanned from; or add the terms a person kept from a scan. Translation
 * only; `$server/glossary` decides what is written. `add-scanned` is the
 * accept step for Claude's drafted terms, and runs no model.
 *
 * Responds with `{ ok: true, path }` (and `added` for add-scanned), or
 * `{ ok: false, reason, message }` with 409 for a clash, 404 for an unknown
 * glossary and 400 for a bad request.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	const { vault, ready, workspaces } = hub();
	await ready;

	const reply = (result: Written | ScanAdded) => json(result, { status: result.ok ? 200 : STATUS[result.reason] });
	if (body.action === 'create-glossary') return reply(await createGlossary(vault, String(body.name ?? '')));

	const glossary = await findGlossary(vault, await workspaces(), String(body.glossary ?? ''));
	if (!glossary) return json({ ok: false, reason: 'not-found', message: 'No such glossary.' }, { status: 404 });

	const text = (value: unknown) => (typeof value === 'string' ? value : null);
	switch (body.action) {
		case 'rename-glossary':
			return reply(await renameGlossary(vault, glossary, String(body.name ?? '')));
		case 'delete-glossary':
			return reply(await deleteGlossary(vault, glossary));
		case 'add':
			return reply(
				await addTerm(vault, glossary.path, {
					term: String(body.term ?? ''),
					category: text(body.category),
					source: text(body.source)
				})
			);
		case 'edit': {
			const c = body.change ?? {};
			const optional = (value: unknown) => (typeof value === 'string' ? value : undefined);
			return reply(
				await editTerm(vault, glossary.path, String(body.term ?? ''), {
					term: optional(c.term),
					category: optional(c.category),
					definition: optional(c.definition),
					relevance: optional(c.relevance)
				})
			);
		}
		case 'delete':
			return reply(await deleteTerm(vault, glossary.path, String(body.term ?? '')));
		case 'set-sources':
			return reply(await setGlossarySources(vault, glossary, body.sources));
		case 'add-scanned':
			return reply(await addScannedTerms(vault, glossary, { entries: body.entries, complete: body.complete }, today()));
		default:
			return json({ ok: false, reason: 'invalid', message: 'Unknown action.' }, { status: 400 });
	}
};
