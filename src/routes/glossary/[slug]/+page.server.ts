import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { linkHref, renderNote } from '$server/render';
import { findGlossary, loadGlossary } from '$server/glossary';
import { glossaryCardsState } from '$server/study/glossary-cards';
import { subjectsOf } from '$server/study/subjects';
import type { PageServerLoad } from './$types';

/**
 * One glossary: every entry of its file ready to draw, the study subject its
 * cards go to with how they stand, and the subjects it could go to. Reads its
 * card folder. Only an unknown slug is a 404. Writes nothing.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { vault, index, workspaces } = await hub();
	const all = await workspaces();
	const ref = await findGlossary(vault, all, params.slug);
	if (!ref) error(404, 'No such glossary');

	const glossary = await loadGlossary(vault, ref.path);

	const entries = glossary.entries.map((e) => {
		const link = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/.exec(e.source?.trim() ?? '');
		return {
			term: e.term,
			category: e.category,
			pending: e.pending,
			lookedUp: e.status === 'looked-up',
			drafted: (e.fields.drafted?.value ?? '').toLowerCase() === 'claude',
			source: e.source ? { label: link ? (link[2] ?? link[1]).trim() : e.source, href: link ? linkHref(index, link[1].trim()) : null } : null,
			definition: e.definition ? renderNote(index, e.definition) : '',
			/** The definition as written, for the edit form. */
			definitionRaw: e.definition,
			relevance: e.relevance
		};
	});

	return {
		glossary: { name: ref.name, slug: ref.slug, color: ref.color, path: ref.path },
		entries,
		categories: [...new Set(glossary.entries.map((e) => e.category).filter((c): c is string => Boolean(c)))],
		cards: await glossaryCardsState(vault, all, ref.path),
		subjects: subjectsOf(all).map((s) => ({ slug: s.slug, name: s.name }))
	};
};
