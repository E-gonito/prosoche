/**
 * A workspace's deals: the pipeline in its `Deals.md`.
 *
 * Creating a deal appends a line, the same append-only rule every write in
 * this app follows; changing a stage rewrites that field alone, through the
 * character span `parse/deal.ts` finds, guarded against the line having
 * changed on another device — the same guard `tasks.ts` gives a task.
 */

import { homeFolder, type Workspace } from './workspaces';
import { parseDealLine, rewriteDealField, scanDeals, type Deal } from './parse/deal';
import type { Vault } from './vault/index';

export interface NewDeal {
	text: string;
	person?: string | null;
	stage?: string | null;
	value?: string | null;
	next?: string | null;
}

export type DealAdded = { ok: true; deal: Deal } | { ok: false; reason: 'no-text' | 'conflict' };

/** Vault-relative path of a workspace's deal pipeline. */
export function dealsPath(workspace: Workspace): string {
	return `${homeFolder(workspace)}/Deals.md`;
}

/** Every deal in a workspace's pipeline, in file order. Reads; writes nothing. */
export async function listDeals(vault: Vault, workspace: Workspace): Promise<Deal[]> {
	const note = await vault.read(dealsPath(workspace));
	return note.exists ? scanDeals(note.content) : [];
}

/**
 * Append one deal line to `<home>/Deals.md`, creating the note when it does
 * not exist yet. The stage defaults to the workspace's own first stage (or
 * the default pipeline's) so a fresh deal always lands somewhere on the
 * board, never off it.
 */
export async function addDeal(vault: Vault, workspace: Workspace, spec: NewDeal): Promise<DealAdded> {
	const name = (spec.text ?? '').replace(/\s+/g, ' ').trim();
	if (!name) return { ok: false, reason: 'no-text' };

	const path = dealsPath(workspace);
	const note = await vault.read(path);

	const parts = [name];
	if (spec.person?.trim()) parts.push(`[[${spec.person.trim()}]]`);
	parts.push(`stage:: ${spec.stage?.trim() || workspace.stages[0] || 'lead'}`);
	if (spec.value?.trim()) parts.push(`value:: ${spec.value.trim()}`);
	if (spec.next?.trim()) parts.push(`next:: ${spec.next.trim()}`);
	const line = `- ${parts.join(' ')}`;

	const before = note.exists ? note.content : `# ${workspace.name} deals\n\n`;
	const updated = before === '' || before.endsWith('\n') ? `${before}${line}\n` : `${before}\n${line}`;

	const result = await vault.write(path, updated, note.exists ? note.hash : undefined);
	if (!result.ok) return { ok: false, reason: 'conflict' };

	const lines = updated.split('\n');
	const at = lines.lastIndexOf(line);
	return { ok: true, deal: parseDealLine(line, at)! };
}

export type DealStageChanged =
	| { ok: true; deal: Deal }
	| { ok: false; reason: 'no-note' }
	| { ok: false; reason: 'not-a-deal' }
	| { ok: false; reason: 'line-changed'; current: string | null };

/**
 * Move one deal to a new stage, guarded per line the way `updateTask` guards
 * a task: when `expectedRaw` no longer matches, nothing is written and the
 * current line comes back so the UI can refresh instead of clobbering
 * someone else's edit.
 */
export async function setDealStage(
	vault: Vault,
	workspace: Workspace,
	line: number,
	expectedRaw: string,
	stage: string
): Promise<DealStageChanged> {
	const path = dealsPath(workspace);
	const note = await vault.read(path);
	if (!note.exists) return { ok: false, reason: 'no-note' };

	const lines = note.content.split('\n');
	const current = lines[line] ?? null;
	if (current !== expectedRaw) return { ok: false, reason: 'line-changed', current };
	if (!parseDealLine(current, line)) return { ok: false, reason: 'not-a-deal' };

	const rewritten = rewriteDealField(current, 'stage', stage);
	if (rewritten === current) return { ok: true, deal: parseDealLine(current, line)! };

	lines[line] = rewritten;
	const result = await vault.write(path, lines.join('\n'), note.hash);
	if (!result.ok) return { ok: false, reason: 'line-changed', current: null };

	return { ok: true, deal: parseDealLine(rewritten, line)! };
}
