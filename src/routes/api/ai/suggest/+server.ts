import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { shiftDay, today } from '$server/daily';
import { fileCapture } from '$server/ai/file-capture';
import { suggestCards } from '$server/ai/suggest-cards';
import { draftPrep, draftPrimer } from '$server/ai/meeting-drafts';
import { draftFoundTerms, draftLookups } from '$server/ai/glossary-drafts';
import { findGlossary } from '$server/glossary';
import { eventsBetween } from '$server/calendar';
import type { RequestHandler } from './$types';

/**
 * The features that draft a change and stop.
 *
 * One endpoint rather than one each, because they differ only in what they read:
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
		count?: number;
		/** The meeting features: which workspace, and what about. */
		slug?: string;
		title?: string;
		event?: string;
		/** The glossary features: which glossary, by slug, and what about. */
		glossary?: string;
		terms?: string[];
		folder?: string;
		from?: number;
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

	// A glossary's two drafts, both under the look-up's settings and policy.
	// Each names its one destination, the glossary's file.
	if (body.feature === 'glossary-lookup' || body.feature === 'glossary-find') {
		const glossary = await findGlossary(vault, await workspaces(), String(body.glossary ?? ''));
		if (!glossary) return json({ error: 'no such glossary' }, { status: 404 });
		if (body.feature === 'glossary-find') {
			return json(await draftFoundTerms(vault, glossary, { folder: String(body.folder ?? ''), from: Number(body.from) || 0 }));
		}
		const terms = Array.isArray(body.terms) ? body.terms.filter((t) => typeof t === 'string') : null;
		return json(await draftLookups(vault, glossary, terms));
	}

	// The meeting notebook's two drafts. Each names its one destination.
	if (body.feature === 'primer-draft' || body.feature === 'meeting-prep') {
		const workspace = (await workspaces()).find((w) => w.slug === body.slug);
		if (!workspace) return json({ error: 'no such workspace' }, { status: 404 });
		if (body.feature === 'primer-draft') return json(await draftPrimer(vault, workspace));
		const day = today();
		const calendar = body.event ? await eventsBetween(day, shiftDay(day, 7)) : null;
		const event = calendar?.ok ? (calendar.events.find((e) => e.id === body.event) ?? null) : null;
		return json(await draftPrep(vault, workspace, { title: body.title ?? '', today: day, event }));
	}

	return json({ error: 'unknown feature' }, { status: 400 });
};
