import { hub } from '$server/hub';
import { glossaries } from '$server/glossary';
import { characters } from '$server/cute';
import type { SubItem } from '$lib/modules';
import type { LayoutServerLoad } from './$types';

/**
 * What the rail nests under each module, on every page, keyed by module id:
 * every workspace under Workspaces, every glossary in `Glossaries/` under
 * Glossary, every study subject under Study, every graph under Graph, and every character under Cute. Name, colour and link
 * only: the rail is a way in, not a report. `hasPrivate` says whether the
 * vault has a private folder, so a private module is only drawn where it
 * has somewhere to keep its data.
 */
export const load: LayoutServerLoad = async () => {
	const { vault, workspaces, subjects, graphs } = await hub();
	const all = await workspaces();
	const sub: Record<string, SubItem[]> = {
		w: all.map((w) => ({ href: `/w/${w.slug}`, title: w.name, color: w.color })),
		glossary: (await glossaries(vault, all)).map((g) => ({ href: `/glossary/${g.slug}`, title: g.name, color: g.color })),
		study: (await subjects()).map((s) => ({ href: `/study/${s.slug}`, title: s.name, color: s.color })),
		graph: (await graphs()).map((g) => ({ href: `/graph/${g.slug}`, title: g.name, color: g.color })),
		cute: (await characters(vault)).map((c) => ({ href: `/cute/${c.slug}`, title: c.name, color: '#d16b95' }))
	};
	return { sub, hasPrivate: await vault.hasPrivate() };
};
