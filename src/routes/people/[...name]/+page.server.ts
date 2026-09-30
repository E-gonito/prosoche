import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { person, personName } from '$server/people';
import { renderNote } from '$server/render';
import type { PageServerLoad } from './$types';

/**
 * One person's page, reached by following a wiki-link. There is deliberately
 * no page listing everyone; a workspace's contacts are its CRM instead.
 *
 * Someone with no note is not an error. Their page shows who has mentioned them
 * and offers the log box, and writing the first line is what creates the note.
 */
export const load: PageServerLoad = async ({ params }) => {
	const name = personName(params.name);
	if (!name) error(404, 'No such person');

	const { vault, index } = await hub();

	const who = await person(vault, index, name);
	return {
		...who,
		html: who.exists ? renderNote(index, who.body) : ''
	};
};
