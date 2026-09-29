import { hub } from '$server/hub';
import { today } from '$server/daily';
import { recentRuns, spentOn } from '$server/ai/audit';
import { loadSettings, SETTINGS_PATH } from '$server/ai/settings';
import { listSnapshots } from '$server/ai/sandbox';
import { cliConfig } from '$server/ai/cli';
import type { PageServerLoad } from './$types';

/**
 * The AI settings page: the controls, and the evidence.
 *
 * The audit log and the undo snapshots are loaded alongside the form on
 * purpose. Settings that promise a daily cap and a seven-day undo are worth
 * very little if the page cannot show what has actually been spent and what
 * can actually be put back.
 */
export const load: PageServerLoad = async () => {
	const { vault, ready } = hub();
	await ready;

	const day = today();
	const [settings, spend, runs, snapshots] = await Promise.all([
		loadSettings(vault),
		spentOn(vault, day),
		recentRuns(vault, day, 25),
		listSnapshots()
	]);

	return {
		settings,
		spend,
		runs,
		day,
		settingsPath: SETTINGS_PATH,
		/** Shown so it is obvious which binary would run, fake or real. */
		executable: cliConfig.executable,
		snapshots: snapshots.slice(0, 10).map((s) => ({ id: s.id, at: s.at, paths: s.paths }))
	};
};
