import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import type { RequestHandler } from './$types';

/** Current sync state. Polled by the header badge. */
export const GET: RequestHandler = async () => {
	return json(await hub().vault.sync.status());
};

interface Body {
	action?: string;
	paths?: string[];
	message?: string;
}

/**
 * `pull`, `push`, `commit`, `discard` or `rebuild`.
 *
 * `commit` stages only the paths it is given. `discard` is the one
 * irreversible action here and always snapshots first; the caller is expected
 * to have confirmed it with the user, and the response says where the
 * snapshot went so that is recoverable too.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { action, paths, message } = (await request.json()) as Body;
	const { vault, rebuild } = hub();
	const sync = vault.sync;

	switch (action) {
		case 'pull':
			return json(await sync.pull());
		case 'push':
			return json(await sync.push('prosoche: manual sync'));
		case 'rebuild':
			return json({ tookMs: await rebuild() });
		case 'commit': {
			if (!paths?.length) return json({ error: 'Select at least one file' }, { status: 400 });
			const status = await sync.commit(paths, message?.trim() || '');
			return json({ ok: true, status, committed: paths.length });
		}
		case 'discard': {
			if (!paths?.length) return json({ error: 'Select at least one file' }, { status: 400 });
			const result = await sync.discard(paths);
			return json(result, { status: result.error ? 422 : 200 });
		}
		default:
			return json({ error: `Unknown action: ${action}` }, { status: 400 });
	}
};
