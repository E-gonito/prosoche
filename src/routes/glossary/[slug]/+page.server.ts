import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { renderMarkdown } from '$server/render';
import { findGlossary, loadGlossary } from '$server/glossary';
import { capturedTerms } from '$server/meetings';
import { noteFolders } from '$server/ai/glossary-drafts';
import { noteHref } from '$lib/shared/links';
import type { PageServerLoad } from './$types';

/**
 * One glossary: every entry of its file ready to draw, the terms captured in
 * the meetings of every workspace pointing at it that it does not have yet,
 * those workspaces (their notebooks are linked), and the vault's folders, offered
 * when finding terms in notes. Only an unknown slug is a 404.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { vault, index, ready, workspaces } = hub();
	await ready;
	const ref = await findGlossary(vault, await workspaces(), params.slug);
	if (!ref) error(404, 'No such glossary');
	const withMeetings = ref.linked.filter((w) => w.meetings);

	const resolve = (target: string) => {
		const found = index.resolveLink(target);
		return found ? noteHref(found) : null;
	};
	const glossary = await loadGlossary(vault, ref.path, await capturedTerms(vault, withMeetings));

	const entries = glossary.entries.map((e) => {
		const link = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/.exec(e.source?.trim() ?? '');
		return {
			term: e.term,
			category: e.category,
			pending: e.pending,
			lookedUp: e.status === 'looked-up',
			drafted: (e.fields.drafted?.value ?? '').toLowerCase() === 'claude',
			source: e.source ? { label: link ? (link[2] ?? link[1]).trim() : e.source, href: link ? resolve(link[1].trim()) : null } : null,
			definition: e.definition ? renderMarkdown(e.definition, resolve) : '',
			/** The definition as written, for the edit form. */
			definitionRaw: e.definition,
			relevance: e.relevance
		};
	});

	return {
		glossary: { name: ref.name, slug: ref.slug, color: ref.color, path: ref.path },
		/** Every workspace pointing here, and which of them hold meetings. */
		linked: ref.linked.map((w) => ({ slug: w.slug, name: w.name, meetings: w.meetings === true })),
		entries,
		captured: glossary.captured,
		categories: [...new Set(glossary.entries.map((e) => e.category).filter((c): c is string => Boolean(c)))],
		folders: await noteFolders(vault)
	};
};
