import { addDatingPerson, STAGES } from '$server/dating';
import { refuse, route, str } from '../../route';

/** Create a new dating person's note. Answers `{ path }`; a name that already has one is a 409. */
export const POST = route(
	async ({ body, hub }) => {
		const name = str(body.name);
		if (!name) return refuse('invalid', 'name is required');
		const stage = STAGES.find((s) => s === body.stage);
		return addDatingPerson(hub.vault, {
			name,
			app: str(body.app),
			age: str(body.age),
			place: str(body.place),
			job: str(body.job),
			stage,
			notes: str(body.notes)
		});
	},
	{ exists: 'There is already a note for that name.' }
);
