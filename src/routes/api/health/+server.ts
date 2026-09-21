import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { config } from '$server/config';
import type { RequestHandler } from './$types';

/** Liveness and a one-glance view of what the server thinks it has. */
export const GET: RequestHandler = async () => {
	const { index, vault, ready } = hub();
	await ready;
	const health = index.health();
	const sync = await vault.sync.status();
	return json({
		ok: health.notes > 0 && sync.conflicts.length === 0,
		vault: config.vaultPath,
		notes: health.notes,
		tasks: health.tasks,
		lastBuildMs: health.lastBuildMs,
		parseProblems: health.problems.length,
		sync: { provider: sync.provider, lastPull: sync.lastPull, pending: sync.pending.length, error: sync.error },
		uptimeSeconds: Math.round(process.uptime())
	});
};
