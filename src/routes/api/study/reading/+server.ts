import { changeReadingList } from '$server/study/reading';
import { subjectOf } from '$server/study/subjects';
import type { ReadingOp } from '$lib/shared/study';
import { noSubject, refuse, route } from '../../route';

/**
 * Change a subject's reading list: `{ subject, hash, op }`, where `hash` is
 * the list's hash as the page last saw it. Every answer carries `list`, the
 * list as it now is: 200 when the op was applied, 409 when the file had
 * changed first, a refusal with a sentence when the op made no sense. The
 * last two write nothing.
 */
export const POST = route<{ subject: string; hash: string; op: ReadingOp }>(
	async ({ body, hub }) => {
		if (!body.subject || typeof body.hash !== 'string' || !body.op) return refuse('invalid', 'subject, hash and op are required');
		const subject = subjectOf(await hub.workspaces(), body.subject);
		return subject ? changeReadingList(hub.vault, subject, body.hash, body.op) : noSubject();
	},
	{ conflict: 'The reading list changed somewhere else. It has been reloaded; try again.' }
);
