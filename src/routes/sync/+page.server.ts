import { hub } from '$server/hub';
import { config } from '$server/config';
import { loadSettings } from '$server/ai/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const { vault, index } = await hub();
	return {
		status: await vault.sync.status(),
		files: await vault.sync.pending(),
		health: index.health(),
		vaultPath: config.vaultPath,
		undoPath: config.undoPath,
		branch: config.git.branch,
		commitDebounceSeconds: config.git.commitDebounceMs / 1000,
		pullIntervalSeconds: config.git.pullIntervalMs / 1000,
		/** Whether Suggest is offered: it asks a model for the commit message. */
		aiEnabled: (await loadSettings(vault)).enabled
	};
};
