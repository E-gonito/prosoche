import { hub } from '$server/hub';
import { characters } from '$server/cute';
import { cuteMediaHref, type Picture } from '$lib/shared/cute';
import type { PageServerLoad } from './$types';

/** Every character with its cover, its newest picture, and how many it has. Never writes. */
export const load: PageServerLoad = async () => {
	const { vault } = await hub();
	return {
		characters: (await characters(vault)).map((c) => {
			const newest = c.media[0];
			const cover: Picture | null = newest
				? newest.kind === 'file'
					? { src: cuteMediaHref(newest.name), label: newest.name, gif: /\.gif$/i.test(newest.name), remote: false }
					: { src: newest.url, label: newest.url, gif: /\.gif/i.test(newest.url), remote: true }
				: null;
			return { name: c.name, slug: c.slug, count: c.media.length, cover };
		})
	};
};
