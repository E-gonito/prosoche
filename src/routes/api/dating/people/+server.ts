import { addDatingPerson, STAGES } from '$server/dating';
import { isDayKey } from '$server/daily';
import { refuse, route, str } from '../../route';

/**
 * Create a new dating person's note. Answers `{ path }`; a name that already
 * has one is a 409. Logging a like sent is this with `stage: 'liked'`, a
 * `liked` day and a `chance` from 0 to 100.
 */
export const POST = route(
	async ({ body, hub }) => {
		const name = str(body.name);
		if (!name) return refuse('invalid', 'name is required');
		const stage = STAGES.find((s) => s === body.stage);
		const liked = str(body.liked);
		const chance = body.chance;
		if (chance !== undefined && (typeof chance !== 'number' || chance < 0 || chance > 100)) {
			return refuse('invalid', 'chance must be a number from 0 to 100');
		}
		return addDatingPerson(hub.vault, {
			name,
			app: str(body.app),
			age: str(body.age),
			place: str(body.place),
			job: str(body.job),
			stage,
			notes: str(body.notes),
			liked: liked && isDayKey(liked) ? liked : undefined,
			chance
		});
	},
	{ exists: 'There is already a note for that name.' }
);
