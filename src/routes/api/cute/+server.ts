import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { fileImage, MAX_BYTES } from '$server/cute';
import type { RequestHandler } from './$types';

const STATUS: Record<string, number> = { 'bad-type': 415, 'too-large': 413, 'not-found': 404, 'no-name': 400, exists: 409, conflict: 409 };

/**
 * File one image: the request body is the image's own bytes, sent with its
 * image type, and the query names where it goes, `?character=<slug>` or
 * `?create=<new name>`. Answers `{ ok, character, slug, file, type }`, or
 * `{ ok: false, error }` with a status.
 *
 * Raw bytes rather than a form upload on purpose: a form post is what a
 * hostile page can send cross-site, so SvelteKit refuses one whose origin it
 * cannot match, and behind Tailscale it often cannot. A body typed `image/*`
 * is not one a browser sends cross-site without asking first, so the same
 * protection holds without the origin check.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	if (!(request.headers.get('content-type') ?? '').startsWith('image/')) return json({ ok: false, error: 'Send the image itself, typed image/….' }, { status: 415 });
	const character = url.searchParams.get('character');
	const create = url.searchParams.get('create');
	if (!character && !create) return json({ ok: false, error: 'Say which character it goes to.' }, { status: 400 });
	if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return json({ ok: false, error: `That image is over ${MAX_BYTES / 1024 / 1024} MB.` }, { status: 413 });

	const bytes = new Uint8Array(await request.arrayBuffer());
	const { vault } = await hub();
	const filed = await fileImage(vault, bytes, character || { create: create! }, new Date());
	if (filed.ok) return json(filed);
	return json({ ok: false, reason: filed.reason, error: filed.message }, { status: STATUS[filed.reason] ?? 422 });
};
