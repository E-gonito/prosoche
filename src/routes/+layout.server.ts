import { hub } from '$server/hub';
import { openCards } from '$server/board';
import type { LayoutServerLoad } from './$types';

/**
 * The workspace rail, on every page.
 *
 * The count beside each workspace is its open cards — the same set its board
 * shows and Today lists, so the three never disagree. Q1 goes to the tooltip
 * rather than the badge: it comes free from the cards already read, and the
 * number that should make someone click is how much is open at all.
 */
export const load: LayoutServerLoad = async () => {
	const { index, ready, workspaces } = hub();
	await ready;

	const defs = await workspaces();
	return {
		workspaces: defs.map((w) => {
			const cards = openCards(index, w, defs);
			return {
				slug: w.slug,
				name: w.name,
				color: w.color,
				open: cards.length,
				urgent: cards.filter((task) => task.quadrant === 1).length
			};
		})
	};
};
