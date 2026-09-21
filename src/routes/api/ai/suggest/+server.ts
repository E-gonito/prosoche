import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { isDayKey, today } from '$server/daily';
import { fileCapture } from '$server/ai/file-capture';
import { suggestCards } from '$server/ai/suggest-cards';
import { draft, draftPath } from '$server/ai/timesheet-draft';
import type { RequestHandler } from './$types';

/**
 * The three features that draft a change and stop.
 *
 * One endpoint rather than three, because they differ only in what they read:
 * each produces a `Proposal` that goes to the same `/api/ai/proposal` to be
 * validated and applied, and having one door in keeps that true. The
 * `destinations` a caller must pass to apply are returned alongside, since
 * this is the code that knows what each run is about and the browser should
 * not be inventing paths for the path policy to check.
 *
 * Responds 200 with a problem rather than an error status: a model that was
 * over budget, refused, or chose a path it was not offered is an answer to
 * show, not an exception for the browser to catch.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		feature?: string;
		path?: string;
		line?: number;
		expectedRaw?: string;
		day?: string;
		count?: number;
	};
	const { vault, index, ready, workspaces } = hub();
	await ready;

	if (body.feature === 'capture') {
		if (typeof body.line !== 'number' || typeof body.expectedRaw !== 'string') {
			return json({ error: 'line and expectedRaw are required' }, { status: 400 });
		}
		const result = await fileCapture(
			{ vault, index, workspaces: await workspaces() },
			{ line: body.line, expectedRaw: body.expectedRaw, path: body.path }
		);
		return json({
			...result,
			destinations: result.proposal?.edits.map((e) => e.path) ?? []
		});
	}

	if (body.feature === 'suggest-flashcards') {
		if (!body.path) return json({ error: 'path is required' }, { status: 400 });
		const result = await suggestCards(vault, body.path, { count: body.count });
		return json({ ...result, destinations: [body.path] });
	}

	if (body.feature === 'timesheet') {
		const day = body.day && isDayKey(body.day) ? body.day : today();
		const result = await draft(vault, index, day);
		return json({ ...result, destinations: [draftPath(day)] });
	}

	return json({ error: 'unknown feature' }, { status: 400 });
};
