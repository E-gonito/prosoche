import { setStage, STAGES } from '$server/dating';
import { refuse, route, str } from '../../../route';

/** Set a person's stage, `{ name, stage }`; a stage that means she replied also resolves her pending like (see `setStage`). */
export const POST = route(
	async ({ body, hub }) => {
		const name = str(body.name);
		const stage = STAGES.find((s) => s === body.stage);
		if (!name) return refuse('invalid', 'name is required');
		if (!stage) return refuse('invalid', `stage must be one of ${STAGES.join(', ')}`);
		return setStage(hub.vault, name, stage);
	},
	{ 'no-note': 'There is no note for that name yet.' }
);
