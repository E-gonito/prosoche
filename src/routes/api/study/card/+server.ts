import { today } from '$server/daily';
import { gradeAt } from '$server/study/flashcards';
import { subjectsOf } from '$server/study/subjects';
import { GRADES, type Grade } from '$lib/shared/scheduler';
import { refuse, route, str } from '../../route';

/**
 * Grade one card: `{ path, line, index, expectedRaw, grade }` (see
 * `gradeAt`). Answers `{ card, shift }`. A card changed underneath is a 409,
 * which the review page shows as a refusal, and one no longer there is a 404.
 */
export const POST = route(
	async ({ body, hub }) => {
		const path = str(body.path);
		const grade = GRADES.find((g) => g === body.grade) as Grade | undefined;
		if (!path || typeof body.line !== 'number' || !grade) {
			return refuse('invalid', 'path, line and a grade of again, hard, good or easy are required');
		}
		const at = { path, line: body.line, index: typeof body.index === 'number' ? body.index : 0, expectedRaw: str(body.expectedRaw) };
		return gradeAt(hub.vault, subjectsOf(await hub.workspaces()), at, grade, today());
	},
	{ 'no-note': 'No such note.', 'no-card': 'That card is no longer in the note.' }
);
