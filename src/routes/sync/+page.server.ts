import { hub } from '$server/hub';
import { config } from '$server/config';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const { vault, index, ready } = hub();
	await ready;
	return {
		status: await vault.sync.status(),
		files: await vault.sync.pending(),
		health: index.health(),
		vaultPath: config.vaultPath,
		undoPath: config.undoPath,
		branch: config.git.branch,
		commitDebounceMinutes: config.git.commitDebounceMs / 60000,
		pullIntervalMinutes: config.git.pullIntervalMs / 60000
	};
};
