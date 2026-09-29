import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { renderMarkdown } from '$server/render';
import { loadGlossary } from '$server/glossary';
import { capturedTerms } from '$server/meetings';
import { noteHref } from '$lib/shared/links';
import type { PageServerLoad } from './$types';

/**
 * One workspace's glossary: every entry of `Glossary.md` ready to draw, and
 * the terms captured in its meetings that it does not have yet. A workspace
 * without meetings simply has none of those. Any workspace can have a
 * glossary, so only an unknown slug is a 404.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { vault, index, ready, workspaces } = hub();
	await ready;
	const ws = (await workspaces()).find((w) => w.slug === params.slug);
	if (!ws) error(404, 'No such workspace');
	const workspace = { slug: ws.slug, name: ws.name, color: ws.color };

	const resolve = (target: string) => {
		const found = index.resolveLink(target);
		return found ? noteHref(found) : null;
	};
	const glossary = await loadGlossary(vault, ws, await capturedTerms(vault, ws));

	const entries = glossary.entries.map((e) => {
		const link = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/.exec(e.source?.trim() ?? '');
		return {
			term: e.term,
			guess: e.guess,
			category: e.category,
			pending: e.pending,
			lookedUp: e.status === 'looked-up',
			drafted: (e.fields.drafted?.value ?? '').toLowerCase() === 'claude',
			source: e.source ? { label: link ? (link[2] ?? link[1]).trim() : e.source, href: link ? resolve(link[1].trim()) : null } : null,
			definition: e.definition ? renderMarkdown(e.definition, resolve) : '',
			relevance: e.relevance
		};
	});

	return {
		workspace,
		meetings: ws.meetings === true,
		path: glossary.path,
		entries,
		captured: glossary.captured,
		categories: [...new Set(glossary.entries.map((e) => e.category).filter((c): c is string => Boolean(c)))]
	};
};
