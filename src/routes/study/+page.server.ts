import { hub } from '$server/hub';
import { readLede } from '$server/parse/note';
import { studySummary, subjectCard } from '$server/study/summary';
import { noteHref } from '$lib/shared/links';
import type { PageServerLoad } from './$types';

/**
 * The Study index: one card per subject — its goals, each with its steps
 * done — with what its Edit form starts from: the description, tag and file
 * of its own definition in `_hub/subjects/`.
 */
export const load: PageServerLoad = async () => {
	const { vault, subjects: readSubjects } = await hub();
	const subjects = await readSubjects();
	return {
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
