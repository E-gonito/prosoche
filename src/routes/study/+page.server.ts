import { hub } from '$server/hub';
import { readLede } from '$server/parse/note';
import { studySummary, subjectCard } from '$server/study/summary';
import { dailyNotePath, today } from '$server/daily';
import { blockMinutes, nextBlock } from '$server/study/block';
import { readSession } from '$server/focus/session';
import { focusOn } from '$server/study/summary';
import { noteHref } from '$lib/shared/links';
import type { PageServerLoad } from './$types';

/**
 * The Study index: first the one thing to study now, then one card per
 * subject — its goals, each with its steps done — with what its Edit form
 * starts from: the description, tag and file of its own definition in
 * `_hub/subjects/`.
 *
 * The one thing is the running session if there is one, else the subject of
 * today's next block in the daily note (`nextBlock`). It is null when
 * nothing is blocked. Never writes.
 */
export const load: PageServerLoad = async () => {
	const { vault, subjects: readSubjects } = await hub();
	const subjects = await readSubjects();
	const day = today();
	const now = new Date();
	const running = await readSession(vault);
	const note = await vault.read(dailyNotePath(day));
	const found = running || !note.exists ? null : nextBlock(note.content, subjects.map((s) => ({ ...s, names: [s.name, ...s.aliases] })), now.getHours() * 60 + now.getMinutes());
	const studying = running?.kind === 'study' ? running : null;
	const target = studying ? subjects.find((s) => s.slug === studying.subject) : found?.subject;
	const focus = target && !running ? focusOn(await studySummary(vault, target), day) : null;
	const step = studying ? studying.step.text : (focus?.steps.find((s) => s.state === 'now')?.task.text ?? null);
	return {
		now: target
			? {
					slug: target.slug,
					name: target.name,
					color: target.color,
					running: Boolean(studying),
					step,
					minutes: studying ? studying.minutes : blockMinutes(found?.block ?? null),
					at: found?.block.startMin ?? null
				}
			: null,
		subjects: await Promise.all(
			subjects.map(async (s) => ({
				...subjectCard(await studySummary(vault, s)),
				description: readLede((await vault.read(s.path)).content),
				tag: s.scope.tags?.[0] ?? '',
				fileHref: noteHref(s.path)
			}))
		)
	};
};
