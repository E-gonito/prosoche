import { addDatingDate } from '$server/dating';
import { isDayKey } from '$server/daily';
import { refuse, route, str } from '../../../route';

/** Append one line to a person's `## Dates` log, creating their note if needed. Answers `{ line }`. */
export const POST = route(
	async ({ body, hub }) => {
		const name = str(body.name);
		if (!name) return refuse('invalid', 'name is required');
		const day = str(body.day);
		const number = (value: unknown) => (typeof value === 'number' ? value : null);
		return addDatingDate(hub.vault, name, {
			day: day && isDayKey(day) ? day : undefined,
			text: str(body.text) ?? '',
			rating: number(body.rating),
			cost: number(body.cost),
			notes: str(body.notes)
		});
	},
	{ 'no-text': 'Say what the date was first.' }
);
