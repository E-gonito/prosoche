import { hub } from '$server/hub';
import { config } from '$server/config';
import { OPEN_STATUSES } from '$lib/shared/task';
import type { LayoutServerLoad } from './$types';

/**
 * The workspace rail, on every page.
 *
 * The count beside each workspace is its open Q1 work, because that is the
 * number that should make someone click. Daily notes are excluded: they are
 * copies of one template, so counting them would show the same figure
 * everywhere.
 */
export const load: LayoutServerLoad = async () => {
	const { index, ready, workspaces } = hub();
	await ready;

	const exclude = [`${config.hubFolder}/`];
	const defs = await workspaces();
	return {
		workspaces: defs.map((w) => ({
			slug: w.slug,
			name: w.name,
			color: w.color,
			urgent: index.findTasks({
				tags: [w.tag],
				under: w.folders,
				statuses: OPEN_STATUSES,
				quadrant: 1,
				excludePrefixes: exclude,
				excludeDailyNotes: true,
				limit: 200
			}).length
		}))
	};
};
