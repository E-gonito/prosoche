import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { parseNote, basename } from '$server/parse/note';
import { renderMarkdown } from '$server/render';
import { isMarkdown, PathOutsideVaultError } from '$server/vault/paths';
import { CONFLICT_MARKERS } from '$server/index/index';
import { subjectFor } from '$server/study/subjects';
import { noteHref } from '$lib/shared/links';
import type { PageServerLoad } from './$types';

/**
 * One note, read-only, with what links to it and where it links.
 *
 * A private note reads as missing here, because the vault gives a public
 * caller nothing from the private folder; a 404 is the whole answer.
 */
export const load: PageServerLoad = async ({ params }) => {
	const path = params.path;
	if (!isMarkdown(path)) error(404, 'Not a note');

	const { vault, index, ready, workspaces } = hub();
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
	const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

	return {
		path,
		folder,
		title: parsed.title || name,
		conflicted: index.problemFor(path) === CONFLICT_MARKERS,
		frontmatter: Object.entries(parsed.frontmatter).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]),
		html: renderMarkdown(parsed.body, (t) => {
			const target = index.resolveLink(t);
			return target ? noteHref(target) : null;
		}),
		tree: await vault.tree(),
		tags: parsed.tags,
		// The study subject the note is in, which is what offers "Make cards".
		subject: subjectFor(await workspaces(), path, parsed.tags)?.name ?? null,
		backlinks: index
			.backlinks(name)
			.filter((b) => b.path !== path)
			.map((b) => ({ path: b.path, title: index.noteTitle(b.path) ?? basename(b.path) })),
		outgoing: [...new Set(parsed.links.map((l) => l.target))]
			.map((target) => ({ target, path: index.resolveLink(target) }))
			.filter((l): l is { target: string; path: string } => l.path !== null)
	};
};
