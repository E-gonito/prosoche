import { hub } from '$server/hub';
import { listGlossaries } from '$server/glossary';
import type { SubItem } from '$lib/modules';
import type { LayoutServerLoad } from './$types';

/**
 * What the rail nests under each module, on every page, keyed by module id:
 * every workspace under Workspaces, and every workspace that has a
 * `Glossary.md` under Glossary. Name, colour and link only: the rail is a
 * way in, not a report.
 */
export const load: LayoutServerLoad = async () => {
	const { vault, ready, workspaces } = hub();
	await ready;
	const all = await workspaces();
	const glossaries = await listGlossaries(vault, all);
	const sub: Record<string, SubItem[]> = {
		w: all.map((w) => ({ href: `/w/${w.slug}`, title: w.name, color: w.color })),
		glossary: glossaries.filter((g) => g.exists).map((g) => ({ href: `/glossary/${g.slug}`, title: g.name, color: g.color }))
	};
	return { sub };
};
