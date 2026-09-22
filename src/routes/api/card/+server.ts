import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { createCard } from '$server/cards';
import { parseNote } from '$server/parse/note';
import { scanTasks, toTask } from '$server/parse/task';
import { workspaceFor } from '$server/workspaces';
import type { RequestHandler } from './$types';

/**
 * One card: read it with its context, or create one.
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

interface NewCardBody {
	workspace?: string;
	text?: string;
	quadrant?: number | null;
	column?: string | null;
}

/** Append a card to a workspace's deck. Returns the task, with its line. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as NewCardBody;
	if (!body.workspace) return json({ error: 'Which workspace is this card for?' }, { status: 400 });

	const { vault, ready, workspaces } = hub();
	await ready;

	const workspace = (await workspaces()).find((w) => w.slug === body.workspace);
	if (!workspace) return json({ error: `There is no workspace called "${body.workspace}".` }, { status: 404 });

	const result = await createCard(vault, workspace, {
		text: body.text ?? '',
		quadrant: body.quadrant ?? null,
		column: body.column ?? null
	});
	if (result.ok) return json({ ok: true, task: result.task }, { status: 201 });

	return json({ error: REASONS[result.reason](workspace.name) }, { status: result.reason === 'conflict' ? 409 : 400 });
};

/** One sentence per refusal, written for the person who will read it. */
const REASONS: Record<'no-text' | 'no-deck' | 'conflict', (workspace: string) => string> = {
	'no-text': () => 'A card needs some words.',
	'no-deck': (workspace) =>
		`${workspace} has no deck note to append to. Give its workspace file a \`deck:\` path.`,
	conflict: (workspace) => `${workspace}'s deck changed on another device. Nothing was written; try again.`
};
