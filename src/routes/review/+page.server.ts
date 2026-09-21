/**
 * Everything the app would like to write, and has not.
 *
 * This page exists because two features run with nobody watching — the Sunday
 * weekly review, and a briefing whose note has no markers yet — and G1 says
 * neither may write without a click. Without somewhere to collect them, those
 * two would produce proposals into the void.
 *
 * Each proposal is validated here rather than in the browser, because a
 * proposal that has been waiting since Sunday may be stale: the note it would
 * touch could have been edited in Obsidian since, and the diff shown must be
 * against the file as it is now, not as it was when the job ran.
 */

import { hub } from '$server/hub';
import { today } from '$server/daily';
import { pending } from '$server/ai/pending';
import { policyFor, validate } from '$server/ai/proposal';
import { loadSettings } from '$server/ai/settings';
import { FEATURE_LABELS } from '$lib/shared/ai';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const { vault, ready } = hub();
	await ready;

	const settings = await loadSettings(vault);
	const queue = await pending(vault);

	const items = [];
	for (const proposal of queue) {
		const policy = policyFor(proposal.feature, settings, { today: today() });
		items.push({
			proposal,
			label: FEATURE_LABELS[proposal.feature] ?? proposal.feature,
			validation: await validate(vault, proposal, policy)
		});
	}

	return { items, enabled: settings.enabled };
};
