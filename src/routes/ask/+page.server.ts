import { hub } from '$server/hub';
import { loadSettings } from '$server/ai/settings';
import { historyPath } from '$server/ai/ask';
import type { PageServerLoad } from './$types';

/**
 * What the Ask page needs before a question is asked: the scopes it can
 * offer, the settings row to show, and the recent conversation.
 *
 * Runs no model. Opening the page must not cost anything, so the question
 * waits for a person; only `/api/ai/ask` spends money.
 */
export const load: PageServerLoad = async ({ url }) => {
	const { vault, ready, workspaces } = hub();
	await ready;

	const [settings, spaces, paths] = await Promise.all([loadSettings(vault), workspaces(), vault.list()]);

	// Top-level folders, so the picker is a short list rather than every
	// directory in the vault.
	const folders = [...new Set(paths.map((p) => p.split('/')[0]).filter((f) => f.includes('.') === false))].sort();

	const history = await vault.read(historyPath(new Date().toISOString()));

	return {
		settings: settings.features.ask,
		enabled: settings.enabled,
		workspaces: spaces.map((w) => ({ slug: w.slug, name: w.name })),
		folders,
		/** A note path from `?note=`, so "ask about this note" can link here. */
		note: url.searchParams.get('note') ?? '',
		question: url.searchParams.get('q') ?? '',
		history: history.exists ? history.content : '',
		historyPath: history.path
	};
};
