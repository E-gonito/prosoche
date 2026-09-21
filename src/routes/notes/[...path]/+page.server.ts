import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { parseNote, basename } from '$server/parse/note';
import { renderMarkdown } from '$server/render';
import { isMarkdown, PathOutsideVaultError } from '$server/vault/paths';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const path = params.path;
	if (!isMarkdown(path)) error(404, 'Not a note');

	const { vault, index, ready } = hub();
	await ready;

	let note;
	try {
		note = await vault.read(path);
	} catch (e) {
		if (e instanceof PathOutsideVaultError) error(404, 'Not a note');
		throw e;
	}
	if (!note.exists) error(404, 'No such note');

	const parsed = parseNote(note.content, path);
	const name = basename(path);
	const editing = url.searchParams.get('edit') !== '0';

	return {
		path,
		title: parsed.title,
		content: note.content,
		hash: note.hash,
		editing,
		frontmatter: parsed.frontmatter,
		html: editing ? '' : renderMarkdown(parsed.body, (t) => linkTo(index.resolveLink(t))),
		tree: await vault.tree(),
		tasks: index.tasksIn(path).filter((t) => !t.fenced),
		tags: parsed.tags,
		// Names for wikilink completion in the editor.
		noteNames: (await vault.list()).map((p) => basename(p)).sort(),
		backlinks: index.backlinks(name).map((b) => ({ ...b, title: index.noteTitle(b.path) ?? basename(b.path) })),
		outgoing: [...new Set(parsed.links.map((l) => l.target))]
			.map((target) => ({ target, path: index.resolveLink(target) }))
			.filter((l) => l.path !== null)
	};
};

function linkTo(path: string | null): string | null {
	return path ? `/notes/${path.split('/').map(encodeURIComponent).join('/')}` : null;
}
