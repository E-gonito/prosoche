import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { person, personName } from '$server/people';
import { renderMarkdown } from '$server/render';
import type { PageServerLoad } from './$types';

/**
 * One person's page, reached from a workspace's people widget or by following a
 * wiki-link. There is deliberately no page listing everyone: people live inside
 * the workspaces that care about them.
 *
 * Someone with no note is not an error. Their page shows who has mentioned them
 * and offers the log box, and writing the first line is what creates the note.
 */
export const load: PageServerLoad = async ({ params }) => {
	const name = personName(params.name);
	if (!name) error(404, 'No such person');

	const { vault, index, ready } = hub();
	await ready;

	const who = await person(vault, index, name);
	return {
		...who,
		html: who.exists ? renderMarkdown(who.body, (t) => linkTo(index.resolveLink(t))) : ''
	};
};

function linkTo(path: string | null): string | null {
	return path ? `/notes/${path.split('/').map(encodeURIComponent).join('/')}` : null;
}
