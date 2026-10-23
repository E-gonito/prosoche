import { redirect } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { isDayKey, today } from '$server/daily';
import { openBlockAt, readSession, sessionName } from '$server/focus/session';
import { focusSettings } from '$server/focus/settings';
import type { PageServerLoad } from './$types';

/**
 * What `/focus/start?day=YYYY-MM-DD&line=N` (`block` also works for `line`) points at: the open timed block at
 * that line of that day's note (`day` defaults to today), or null when it is
 * not one any more, which the page says plainly. A session already running for
 * that block goes straight to `/focus`; one running for another block is
 * named in `busy`. Also says how long the warm-up is (`warmupMin`, from Settings). Never writes.
 */
export const load: PageServerLoad = async ({ url }) => {
	const { vault } = await hub();
	const asked = url.searchParams.get('day');
	const day = asked && isDayKey(asked) ? asked : today();
	const lineParam = url.searchParams.get('line') ?? url.searchParams.get('block') ?? '';
	const line = /^\d+$/.test(lineParam) ? Number(lineParam) : -1;
	const block = line >= 0 ? await openBlockAt(vault, day, line) : null;
	const running = await readSession(vault);
	if (running && block && running.day === day && running.block?.raw === block.raw) redirect(307, '/focus');
	return { day, block, warmupMin: (await focusSettings(vault)).warmupMin, busy: running ? sessionName(running) : null };
};
