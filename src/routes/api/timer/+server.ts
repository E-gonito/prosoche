import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { currentTimer, startTimer, stopTimer, type Appended } from '$server/timelog';
import { PathOutsideVaultError } from '$server/vault/paths';
import type { RunningTimer, TimerState } from '$lib/shared/duration';
import type { RequestHandler } from './$types';

/**
 * The running timer.
 *
 * `GET` reads it, `POST {action:'start', path, line}` starts one and
 * `POST {action:'stop'}` stops it. Every reply is the same `TimerState`, so a
 * client renders the answer the same way whatever it asked: the timer now
 * running, the server's clock so a browser can correct its own, and the entry
 * a stop just wrote.
 *
 * Starting a second timer is not an error. It stops the first and logs it,
 * because that is what the user meant by starting another one.
 */
export const GET: RequestHandler = async () => {
	const { vault, ready } = hub();
	await ready;
	return json(state(await currentTimer(vault), null));
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { action?: string; path?: string; line?: number };
	const { vault, ready, workspaces } = hub();
	await ready;

	if (body.action === 'stop') return json(state(null, await stopTimer(vault)));

	if (body.action === 'start') {
		if (!body.path || typeof body.line !== 'number') {
			return json({ error: 'path and line are required to start a timer' }, { status: 400 });
		}
		try {
			const { timer, stopped } = await startTimer(vault, await workspaces(), { path: body.path, line: body.line });
			return json(state(timer, stopped));
		} catch (e) {
			if (e instanceof PathOutsideVaultError) return json({ error: 'Not a note in this vault' }, { status: 400 });
			throw e;
		}
	}

	return json({ error: "action must be 'start' or 'stop'" }, { status: 400 });
};

function state(timer: RunningTimer | null, stopped: Appended | null): TimerState {
	return {
		timer,
		now: new Date().toISOString(),
		logged: stopped ? { day: stopped.entry.day, minutes: stopped.entry.minutes, text: stopped.entry.text } : null
	};
}
