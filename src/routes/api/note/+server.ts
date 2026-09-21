import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { isMarkdown, PathOutsideVaultError } from '$server/vault/paths';
import type { RequestHandler } from './$types';

/**
 * Save a whole note. `expectedHash` is the hash the editor was opened with;
 * a mismatch responds 409 with both versions so the UI can offer a merge
 * instead of silently overwriting the other device.
 */
export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { path?: string; content?: string; expectedHash?: string };
	if (!body.path || typeof body.content !== 'string') {
		return json({ error: 'path and content are required' }, { status: 400 });
	}
	if (!isMarkdown(body.path)) return json({ error: 'Not a note this app will write' }, { status: 400 });

	try {
		const result = await hub().vault.write(body.path, body.content, body.expectedHash);
		if (result.ok) return json({ ok: true, hash: result.note.hash, mtimeMs: result.note.mtimeMs });
		return json(
			{ ok: false, reason: 'conflict', current: result.current.content, currentHash: result.current.hash },
			{ status: 409 }
		);
	} catch (e) {
		if (e instanceof PathOutsideVaultError) return json({ error: 'Not a note' }, { status: 400 });
		throw e;
	}
};
