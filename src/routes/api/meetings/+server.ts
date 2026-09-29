import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { today } from '$server/daily';
import { assignTitle, captureItem, endMeeting, giveNotebook, notebookPaths, startMeeting } from '$server/meetings';
import type { Written } from '$server/rewrite';
import { CAPTURE_KINDS, type CaptureKind } from '$lib/shared/meetings';
import type { RequestHandler } from './$types';

interface Body {
	action?: 'assign' | 'enable' | 'start' | 'capture' | 'end';
	/** The workspace: every action is about one. */
	slug?: string;
	/** assign: the event title; start: the meeting title. */
	title?: string;
	type?: string;
	event?: string | null;
	attendees?: unknown;
	/** capture and end: the meeting note. */
	path?: string;
	kind?: string;
	text?: string;
}

const STATUS: Record<Exclude<Written, { ok: true }>['reason'], number> = { conflict: 409, 'not-found': 404, invalid: 400 };

/**
 * The notebook's writes, each one a user's click: remember an event's
 * workspace, give a workspace a notebook, start a meeting, capture a line, end a meeting. Translation
 * only; `$server/meetings` decides what is written, including the glossary
 * entry a captured term also gets. Glossary writes of their own go to
 * `/api/glossary`.
 *
 * Responds with `{ ok: true, path }`, or `{ ok: false, reason, message }`
 * with 409 for a clash, 404 for a missing note and 400 for a bad request.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	const { vault, ready, workspaces } = hub();
	await ready;
	const all = await workspaces();

	const reply = (result: Written) => json(result, { status: result.ok ? 200 : STATUS[result.reason] });
	const bad = (message: string) => json({ ok: false, reason: 'invalid', message }, { status: 400 });

	if (body.action === 'assign') return reply(await assignTitle(vault, all, String(body.title ?? ''), String(body.slug ?? '')));

	const workspace = all.find((w) => w.slug === body.slug);
	if (body.action === 'enable') {
		if (!workspace) return json({ ok: false, reason: 'not-found', message: 'No such workspace.' }, { status: 404 });
		return reply(await giveNotebook(vault, workspace));
	}
	const paths = workspace ? notebookPaths(workspace) : null;
	if (!workspace || !paths) return json({ ok: false, reason: 'not-found', message: 'No such workspace, or it has no meetings notebook.' }, { status: 404 });

	switch (body.action) {
		case 'start': {
			const attendees = Array.isArray(body.attendees) ? body.attendees.filter((a): a is string => typeof a === 'string') : [];
			return reply(
				await startMeeting(vault, paths, {
					type: body.type === 'standup' ? 'standup' : 'meeting',
					title: String(body.title ?? ''),
					date: today(),
					event: typeof body.event === 'string' ? body.event : null,
					attendees
				})
			);
		}
		case 'capture': {
			if (!CAPTURE_KINDS.includes(body.kind as CaptureKind)) return bad('Unknown capture type.');
			return reply(
				await captureItem(vault, workspace, String(body.path ?? ''), {
					kind: body.kind as CaptureKind,
					text: String(body.text ?? '')
				})
			);
		}
		case 'end': {
			const now = new Date();
			const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
			return reply(await endMeeting(vault, paths, String(body.path ?? ''), time));
		}
		default:
			return bad('Unknown action.');
	}
};
