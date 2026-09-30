import { refuse, route, str, strings } from '../route';

/** Current sync state. Polled by the header badge. */
export const GET = route(({ hub }) => hub.vault.sync.status());

/**
 * `{ action }`: `pull`, `push`, `commit`, `discard` or `rebuild`.
 *
 * `commit` stages only the `paths` it is given. `discard` is the one
 * irreversible action here and always snapshots first; the caller is expected
 * to have confirmed it with the user, and the answer says where the snapshot
 * went so that is recoverable too. A discard that failed is a refusal with
 * the provider's sentence.
 */
export const POST = route(async ({ body, hub }) => {
	const sync = hub.vault.sync;
	const paths = strings(body.paths) ?? [];
	switch (body.action) {
		case 'pull':
			return sync.pull();
		case 'push':
			return sync.push('prosoche: manual sync');
		case 'rebuild':
			return { tookMs: await hub.rebuild() };
		case 'commit':
			if (!paths.length) return refuse('invalid', 'Select at least one file');
			return { status: await sync.commit(paths, str(body.message)?.trim() || ''), committed: paths.length };
		case 'discard': {
			if (!paths.length) return refuse('invalid', 'Select at least one file');
			const result = await sync.discard(paths);
			return result.error ? { ...result, ...refuse('refused', result.error) } : result;
		}
		default:
			return refuse('invalid', `Unknown action: ${String(body.action)}`);
	}
});
