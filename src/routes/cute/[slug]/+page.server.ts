import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { characters } from '$server/cute';
import { cuteMediaHref, type Picture } from '$lib/shared/cute';
import type { PageServerLoad } from './$types';

/** One character and every picture in its note, newest first. An unknown slug is a 404. Never writes. */
export const load: PageServerLoad = async ({ params }) => {
	const { vault } = await hub();
	const found = (await characters(vault)).find((c) => c.slug === params.slug);
	if (!found) error(404, 'There is no such character.');
	const pictures: Picture[] = found.media.map((m) =>
		m.kind === 'file'
			? { src: cuteMediaHref(m.name), label: m.name, gif: /\.gif$/i.test(m.name), remote: false }
			: { src: m.url, label: m.url, gif: /\.gif/i.test(m.url), remote: true }
	);
	return { name: found.name, slug: found.slug, path: found.path, pictures };
};
