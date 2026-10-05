import { hub } from '$server/hub';
import { parseNote } from '$server/parse/note';
import { renderNote } from '$server/render';
import type { PageServerLoad } from './$types';

/**
 * What only the Overview shows: the subject's principles note,
 * `<home>/Principles.md`, the rules the user studies it by. Sent both as its
 * raw bytes, for the editor, and rendered, for reading; a missing one is
 * empty with `exists: false`, and the first save creates it. The goals come
 * from the layout. Never writes.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const [{ subject }, { vault, index }] = await Promise.all([parent(), hub()]);
	const path = subject.files.principles;
	const note = await vault.read(path);
	return {
		principles: {
			path,
			exists: note.exists,
			raw: note.content,
			hash: note.hash,
			html: note.content.trim() ? renderNote(index, parseNote(note.content, path).body) : ''
		}
	};
};
