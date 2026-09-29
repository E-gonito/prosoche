import { hub } from '$server/hub';
import { renderMarkdown } from '$server/render';
import { loadGlossary, loadMeetings, notebookPaths } from '$server/meetings';
import { noteHref } from '$lib/shared/links';
import type { PageServerLoad } from './$types';

/**
 * The glossary: every entry of `Glossary.md` ready to draw, and the terms
 * captured in meetings that it does not have yet.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { vault, index, workspaces } = hub();
	const { workspace } = await parent();
	const ws = (await workspaces()).find((w) => w.slug === workspace.slug)!;
	const paths = notebookPaths(ws);
	if (!paths) return { path: null, entries: [], captured: [], categories: [] };

	const resolve = (target: string) => {
		const found = index.resolveLink(target);
		return found ? noteHref(found) : null;
	};
	const glossary = await loadGlossary(vault, paths, await loadMeetings(vault, paths));

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
		path: paths.glossary,
		entries,
		captured: glossary.captured,
		categories: [...new Set(glossary.entries.map((e) => e.category).filter((c): c is string => Boolean(c)))]
	};
};
