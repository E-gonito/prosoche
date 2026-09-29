import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { parseNote } from '$server/parse/note';
import { scanTasks, toTask } from '$server/parse/task';
import { workspaceFor } from '$server/workspaces';
import type { RequestHandler } from './$types';

/**
 * One task, read with its context for the card drawer.
 *
 * Reading goes to the vault rather than the index, because the drawer is about
 * to edit the line and has to show the bytes that are there now. It answers
 * with the workspace the card belongs to and the whole list of workspaces, so
 * one request tells the drawer everything it can show or change about the card
 * and no page has to thread the list through as a prop. Every failure is a
 * status code with a sentence the drawer can display; nothing here throws.
 */
export const GET: RequestHandler = async ({ url }) => {
	const path = url.searchParams.get('path');
	const line = Number(url.searchParams.get('line'));
	if (!path || !Number.isInteger(line) || line < 0) {
		return json({ error: 'path and line are required' }, { status: 400 });
	}

	const { vault, index, ready, workspaces } = hub();
	await ready;

	const note = await vault.read(path);
	if (!note.exists) return json({ error: `There is no note at ${path}.` }, { status: 404 });

	const found = scanTasks(note.content).find((task) => task.line === line);
	if (!found) return json({ error: `Line ${line + 1} of ${path} is not a task any more.` }, { status: 404 });

	const lines = note.content.split('\n');
	const parsed = parseNote(note.content, path);
	const defs = await workspaces();
	const owner = workspaceFor(defs, {
		path,
		tags: found.tags,
		frontmatter: parsed.frontmatter,
		text: found.text
	});

	return json({
		task: toTask(found, path),
		// The indented sub-bullets the task owns, shown as written.
		block: lines.slice(found.line + 1, found.blockEnd + 1),
		title: index.noteTitle(path) ?? parsed.title,
		workspace: owner ? { slug: owner.slug, name: owner.name, color: owner.color } : null,
		// Every workspace, with the tag that assigns a card to it. The drawer
		// offers them as a choice and writes the tag it is given; which tag
		// means which workspace stays a question for this module.
		workspaces: defs.map((w) => ({ slug: w.slug, name: w.name, color: w.color, tag: w.tag }))
	});
};
