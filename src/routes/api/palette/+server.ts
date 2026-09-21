import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { fuzzySort } from '$lib/shared/fuzzy';
import { displayText, OPEN_STATUSES } from '$lib/shared/task';
import type { RequestHandler } from './$types';

/**
 * Everything the command palette can find in the vault, for one query.
 *
 * Three kinds of thing in one answer, because the palette shows one list and
 * a second round trip per kind would make it feel slow. Ranking happens here
 * rather than in the browser: the index already holds the tasks, and sending
 * a thousand task lines to the phone to filter them there would be worse.
 *
 * Commands are not here. They only exist in the browser, so the palette mixes
 * them in locally; this endpoint is about the vault.
 */

/** Rows of each kind. Enough to be useful, few enough to scan. */
const NOTES = 6;
const TASKS = 6;
const WORKSPACES = 6;

/** The pool ranked for a task query: everything the boards would show. */
const TASK_POOL = 400;

export const GET: RequestHandler = async ({ url }) => {
	const { index, ready, workspaces } = hub();
	await ready;
	const query = (url.searchParams.get('q') ?? '').trim();

	const spaces = await workspaces();
	const matchedWorkspaces = fuzzySort(query, spaces, (w) => w.name)
		.slice(0, WORKSPACES)
		.map(({ item, match }) => ({ slug: item.slug, name: item.name, color: item.color, positions: match.positions }));

	// An empty box offers the workspaces and nothing else: there is no useful
	// ranking of every note in the vault, and an empty list looks broken.
	if (!query) return json({ query, notes: [], tasks: [], workspaces: matchedWorkspaces });

	const notes = index.search(query, NOTES).map((hit) => ({
		path: hit.path,
		title: hit.title,
		// The index marks matches with «»; the palette highlights its own way,
		// so they are stripped rather than passed on half-rendered.
		snippet: hit.snippet.replace(/«|»/g, '')
	}));

	// Daily notes are excluded because every one of them is a copy of the same
	// template, and a quadrant is what marks a line the user means to do.
	const pool = index.findTasks({
		statuses: OPEN_STATUSES,
		requireQuadrant: true,
		excludeDailyNotes: true,
		limit: TASK_POOL
	});
	const tasks = fuzzySort(query, pool, (task) => displayText(task.text))
		.slice(0, TASKS)
		.map(({ item, match }) => ({
			path: item.path,
			line: item.line,
			text: displayText(item.text),
			quadrant: item.quadrant,
			positions: match.positions
		}));

	return json({ query, notes, tasks, workspaces: matchedWorkspaces });
};
