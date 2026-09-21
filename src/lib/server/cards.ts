/**
 * Creating a card.
 *
 * A card is a task line, so creating one is appending a line to a note — the
 * workspace's deck. Appending is the whole of it: this module never rewrites,
 * reorders or reformats a line that is already there, which is why creating a
 * card cannot lose anything the user wrote, even if the deck is a note they
 * keep by hand.
 *
 * The line it writes is the convention the rest of the vault already uses:
 *
 *     - [ ] Draft the plan `Q2` #ws/work #col/review
 *
 * so Obsidian and the Tasks plugin read it back unchanged.
 */

import { columnsFor } from './board';
import { parseTaskLine, rewriteTaskLine, toTask } from './parse/task';
import type { Task } from '../shared/task';
import type { Vault } from './vault/index';
import type { Workspace } from './workspaces';

export interface NewCard {
	text: string;
	/** 1..4, or null for a card with no quadrant yet. */
	quadrant?: number | null;
	/** Key of the column it should appear in, from `columnsFor`. */
	column?: string | null;
}

export type CardCreated =
	| { ok: true; task: Task }
	| { ok: false; reason: 'no-text' | 'no-deck' | 'conflict' };

/**
 * Append one card to `workspace.deck` and return it, with the path and line
 * the UI needs to open its drawer.
 *
 * Creates the deck note with a heading when it does not exist yet. An existing
 * note keeps its bytes and its trailing-newline habit: a file that ends without
 * a newline still ends without one afterwards.
 *
 * Refuses rather than writes when there are no words to write, when the
 * workspace names no deck, or when the deck changed underneath. Never edits an
 * existing line, and never creates a note outside the deck path.
 */
export async function createCard(vault: Vault, workspace: Workspace, spec: NewCard): Promise<CardCreated> {
	const text = words(spec.text ?? '');
	if (!text) return { ok: false, reason: 'no-text' };

	const deck = workspace.deck?.trim() ?? '';
	if (!deck.endsWith('.md')) return { ok: false, reason: 'no-deck' };

	const column = columnsFor(workspace).find((c) => c.key === spec.column) ?? null;
	const line = taskLine(text, quadrant(spec.quadrant), workspace.tag, column?.tag ?? null, column?.status ?? null);

	const note = await vault.read(deck);
	const before = note.exists ? note.content : `# ${workspace.name}\n\n`;
	const updated = before === '' || before.endsWith('\n') ? `${before}${line}\n` : `${before}\n${line}`;

	const result = await vault.write(deck, updated, note.exists ? note.hash : undefined);
	if (!result.ok) return { ok: false, reason: 'conflict' };

	const lines = updated.split('\n');
	const at = lines.lastIndexOf(line);
	return { ok: true, task: toTask(parseTaskLine(line, at)!, deck) };
}

/**
 * Compose the line. The status marker comes from the rewriter rather than from
 * a table here, so the checkbox characters stay known in exactly one place: a
 * card created in the In progress column is written `- [/]`.
 */
function taskLine(
	text: string,
	quadrant: number | null,
	workspaceTag: string,
	columnTag: string | null,
	status: Task['status'] | null
): string {
	const parts = ['- [ ]', text];
	if (quadrant) parts.push(`\`Q${quadrant}\``);
	parts.push(`#${workspaceTag}`);
	if (columnTag) parts.push(`#${columnTag}`);
	const line = parts.join(' ');
	return status && status !== 'todo' ? rewriteTaskLine(line, { status }) : line;
}

/**
 * The words of the card, as one line. A pasted "- [ ] thing" is accepted and
 * reduced to "thing" rather than becoming a line with two checkboxes, and a
 * pasted paragraph becomes one card rather than silently splitting the file.
 */
function words(input: string): string {
	return input
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^[-*+][ \t]+(\[.\][ \t]+)?/, '')
		.trim();
}

function quadrant(value: number | null | undefined): number | null {
	const q = Math.trunc(Number(value));
	return q >= 1 && q <= 4 ? q : null;
}
