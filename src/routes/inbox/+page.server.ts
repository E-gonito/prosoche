import { hub } from '$server/hub';
import { dailyNotePath, today } from '$server/daily';
import { belongsTo, readInbox, unfiled } from '$server/inbox';
import { CAPTURE_PATH } from '$server/capture';
import type { PageServerLoad } from './$types';

/**
 * The triage page: every unfiled line of `Inbox/Capture.md`, newest day
 * first, the workspaces a line can be filed to, the one each line already
 * names, the study subjects whose reading lists a line can go to, and whether
 * today has a note to plan onto. Reads; never writes.
 */
export const load: PageServerLoad = async () => {
	const { vault, workspaces, subjects } = await hub();
	const [lines, all, studies, note] = await Promise.all([readInbox(vault), workspaces(), subjects(), vault.read(dailyNotePath(today()))]);
	const open = unfiled(lines);
	const owners: Record<number, string> = {};
	for (const line of open) {
		const owner = all.find((w) => belongsTo(line, all, w));
		if (owner) owners[line.line] = owner.slug;
	}
	return {
		path: CAPTURE_PATH,
		lines: open,
		owners,
		workspaces: all.map((w) => ({ slug: w.slug, name: w.name, color: w.color })),
		subjects: studies.map((s) => ({ slug: s.slug, name: s.name, color: s.color })),
		todayExists: note.exists
	};
};
