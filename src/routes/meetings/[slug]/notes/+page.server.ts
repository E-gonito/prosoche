import { hub } from '$server/hub';
import { shiftDay, today } from '$server/daily';
import { eventsBetween } from '$server/calendar';
import { scanTalkingPoints } from '$server/parse/meeting';
import {
	currentMeeting,
	eventForNotebook,
	loadAssignments,
	loadMeetings,
	notebookPaths,
	openActions,
	summarise
} from '$server/meetings';
import type { PageServerLoad } from './$types';

/**
 * The notebook's Notes tab: open actions from every meeting, the meeting
 * under way, and past meetings newest first.
 *
 * Start meeting is prefilled from `?event=<id>` when the link came from an
 * event, else from today's event for this workspace that is on now or next.
 * No calendar means no prefill, never an error.
 */
export const load: PageServerLoad = async ({ parent, url }) => {
	const { vault, workspaces } = hub();
	const { workspace } = await parent();
	const ws = (await workspaces()).find((w) => w.slug === workspace.slug)!;
	const paths = notebookPaths(ws);
	const day = today();
	if (!paths) return { today: day, actions: [], current: null, past: [], prefill: null };

	const meetings = await loadMeetings(vault, paths);
	const current = currentMeeting(meetings, day);

	const wanted = url.searchParams.get('event');
	const calendar = await eventsBetween(day, wanted ? shiftDay(day, 7) : day);
	let event = null;
	if (calendar.ok) {
		const now = new Date();
		event = wanted
			? (calendar.events.find((e) => e.id === wanted) ?? null)
			: eventForNotebook(calendar.events, await loadAssignments(vault), ws.slug, day, now.getHours() * 60 + now.getMinutes());
	}

	return {
		today: day,
		actions: openActions(meetings),
		current: current ? { ...summarise(current), talkingPoints: scanTalkingPoints(current.content) } : null,
		past: meetings.filter((m) => m !== current).map(summarise),
		prefill: event ? { id: event.id, title: event.title, attendees: event.attendees, day: event.day, startMin: event.startMin } : null
	};
};
