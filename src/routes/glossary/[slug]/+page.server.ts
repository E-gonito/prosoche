import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { renderMarkdown } from '$server/render';
import { findGlossary, loadGlossary, noteFolders } from '$server/glossary';
import { capturedTerms } from '$server/meetings';
import { scanPlan } from '$server/ai/glossary-drafts';
import { loadSettings } from '$server/ai/settings';
import { glossaryCardsState } from '$server/study/glossary-cards';
import { subjectsOf } from '$server/study/subjects';
import { noteHref } from '$lib/shared/links';
import type { PageServerLoad } from './$types';

/**
 * One glossary: every entry of its file ready to draw, the terms captured in
 * the meetings of every workspace pointing at it that it does not have yet,
 * those workspaces (their notebooks are linked), what a scan for new terms
 * would read now, the vault's folders it may be scanned from, whether AI
 * is on, and the study subject its cards go to with how they stand, and the
 * subjects it could go to. Reads every note under the glossary's sources to
 * count them, and its card folder. Only an unknown slug is a 404. Writes
 * nothing.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { vault, index, ready, workspaces } = hub();
	await ready;
	const all = await workspaces();
	const ref = await findGlossary(vault, all, params.slug);
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
		folders: await noteFolders(vault),
		scan: await scanPlan(vault, ref),
		aiEnabled: (await loadSettings(vault)).enabled,
		cards: await glossaryCardsState(vault, all, ref.path),
		subjects: subjectsOf(all).map((s) => ({ slug: s.slug, name: s.name }))
	};
};
