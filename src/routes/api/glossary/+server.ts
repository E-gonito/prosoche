import { today } from '$server/daily';
import { addScannedTerms, addTerm, createGlossary, deleteGlossary, deleteTerm, editGlossary, editTerm, findGlossary, setGlossaryFlashcards, setGlossarySources, type ScanAdded } from '$server/glossary';
import { syncGlossaryCards } from '$server/flashcards/glossary-cards';
import type { Written } from '$server/rewrite';
import { refuse, route, str } from '../route';

interface Body {
	action: 'create-glossary' | 'edit-glossary' | 'delete-glossary' | 'add' | 'edit' | 'delete' | 'set-flashcards' | 'set-sources' | 'add-scanned';
	/** Every action but create: the glossary, by slug. */
	glossary: string;
	/** create: the glossary's name. edit-glossary: its new name, if changing. */
	name: string;
	/** edit-glossary: its new description, if changing. */
	description: string;
	/** add: the new term. edit and delete: the term as it is now. */
	term: string;
	/** edit: the fields to change; absent ones are left alone. */
	change: { term?: unknown; category?: unknown; definition?: unknown; relevance?: unknown };
	category: string | null;
	source: string | null;
	/** set-flashcards: whether its terms are flashcards. */
	flashcards: unknown;
	/** set-sources: the folders the glossary is scanned from. */
	sources: unknown;
	/** add-scanned: the entries a person kept, and whether the scan read every note it meant to. */
	entries: unknown;
	complete: unknown;
}

/**
 * The glossaries' writes, each one a user's click: create a glossary, edit
 * its name and description, or delete it; add, edit or delete a term in
 * one; turn its flashcards on or off; set the folders it is scanned from;
 * or add the terms a person
 * kept from a scan. Translation only; `$server/glossary` decides what is
 * written. `add-scanned` is the accept step for Claude's drafted terms, and
 * runs no model.
 *
 * After any of these writes to a glossary, its cards are brought in step
 * (`syncGlossaryCards`) before the response, so the page reloads onto them;
 * a rename moves them to the new name's folder first. A glossary whose
 * cards are off makes that a read and nothing more.
 *
 * Answers `{ path }` (and `added` for add-scanned), or a refusal with its
 * sentence.
 */
export const POST = route<Body>(async ({ body, hub: { vault, workspaces } }) => {
	if (body.action === 'create-glossary') return createGlossary(vault, str(body.name) ?? '');

	const all = await workspaces();
	const glossary = await findGlossary(vault, all, str(body.glossary) ?? '');
	if (!glossary) return refuse('not-found', 'No such glossary.');
	const synced = async (result: Written | ScanAdded, opts: { renamedFrom?: string } = {}) => {
		if (result.ok) await syncGlossaryCards(vault, result.path, opts);
		return result;
	};

	const term = str(body.term) ?? '';
	switch (body.action) {
		case 'edit-glossary': {
			const name = str(body.name);
			const result = await editGlossary(vault, glossary, { name, description: str(body.description) });
			return name === undefined ? result : synced(result, { renamedFrom: glossary.name });
		}
		case 'delete-glossary':
			return deleteGlossary(vault, glossary);
		case 'add':
			return synced(await addTerm(vault, glossary.path, { term, category: str(body.category) ?? null, source: str(body.source) ?? null }));
		case 'edit': {
			const c = body.change ?? {};
			const change = { term: str(c.term), category: str(c.category), definition: str(c.definition), relevance: str(c.relevance) };
			return synced(await editTerm(vault, glossary.path, term, change));
		}
		case 'delete':
			return synced(await deleteTerm(vault, glossary.path, term));
		case 'set-flashcards':
			return synced(await setGlossaryFlashcards(vault, glossary, body.flashcards));
		case 'set-sources':
			return setGlossarySources(vault, glossary, body.sources);
		case 'add-scanned':
			return synced(await addScannedTerms(vault, glossary, { entries: body.entries, complete: body.complete }, today()));
		default:
			return refuse('invalid', 'Unknown action.');
	}
});
