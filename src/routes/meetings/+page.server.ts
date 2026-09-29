import { hub } from '$server/hub';
import { shiftDay, today } from '$server/daily';
import { eventsBetween } from '$server/calendar';
import { isMeetingNote, loadAssignments, notebookPaths, planEvents } from '$server/meetings';
import { basename } from '$server/parse/note';
import type { PageServerLoad } from './$types';

/** Today and the next seven days. */
const DAYS_AHEAD = 7;

/**
 * The week's calendar events with their workspaces, and every notebook.
 *
 * A calendar that is not configured or not reachable is a status to show,
 * not an error: the notebooks below work without one.
 */
export const load: PageServerLoad = async () => {
	const { vault, ready, workspaces } = hub();
	await ready;
	const day = today();
	const all = await workspaces();

	const calendar = await eventsBetween(day, shiftDay(day, DAYS_AHEAD));
	const days = calendar.ok ? planEvents(calendar.events, await loadAssignments(vault), all) : [];

	const notes = await vault.list();
	const notebooks = [];
	for (const w of all) {
		const paths = notebookPaths(w);
		if (!paths) continue;
		const meetings = notes.filter((p) => isMeetingNote(paths, p)).map(basename).sort();
		notebooks.push({
			slug: w.slug,
			name: w.name,
			color: w.color,
			home: paths.home,
			meetings: meetings.length,
			last: meetings.map((m) => /^\d{4}-\d{2}-\d{2}/.exec(m)?.[0]).filter(Boolean).pop() ?? null,
			primer: notes.includes(paths.primer)
		});
	}

	return {
		today: day,
		calendar: calendar.ok ? { ok: true as const } : { ok: false as const, reason: calendar.reason, message: calendar.message },
		days,
		workspaces: all.map((w) => ({ slug: w.slug, name: w.name, color: w.color })),
		notebooks
	};
};
