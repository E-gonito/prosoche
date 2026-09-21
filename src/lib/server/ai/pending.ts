/**
 * Proposals waiting for a human.
 *
 * Every feature that writes produces a proposal and stops. Most are produced
 * while the user is looking at the screen, so the proposal goes straight back
 * over HTTP and is never stored anywhere. Two are not: the Sunday weekly
 * review, and a briefing whose note has no markers yet. Those run with nobody
 * watching, and a proposal nobody can find is the same as a feature that does
 * not work.
 *
 * Those go in one file, `_hub/.state/proposals.json`, which the review page
 * reads. Three consequences of that choice, in the order they matter:
 *
 *  - **Not in SQLite.** The index is a rebuildable cache dropped on every
 *    schema change, and a proposal that vanishes when the schema moves is
 *    worse than one the user can see and delete by hand.
 *  - **One file, not one per proposal.** `Vault.list()` returns markdown, and
 *    a folder of JSON it cannot see would need the filesystem reached for
 *    somewhere it is not allowed. One file is read by path, like the timer.
 *  - **Transient, so never committed.** `_hub/.state/` is in the sync layer's
 *    transient list. Losing this file costs one re-run of a job that is
 *    idempotent anyway; keeping it in git would put a model's draft of the
 *    user's week into their history before they had read it.
 *
 * Nothing here decides anything. A proposal in this queue has exactly the
 * standing of one that just arrived over HTTP: it still passes every
 * guardrail when it is applied, and G1 still requires the click.
 */

import { config } from '../config';
import type { Vault } from '../vault/index';
import type { Proposal } from '$lib/shared/ai';

export const PENDING_PATH = `${config.hubFolder}/.state/proposals.json`;

/** How many are kept. Older ones fall off; the audit log has the history. */
const KEEP = 20;

/**
 * Add a proposal to the queue, newest first.
 *
 * Inputs: the vault and the proposal. Output: the queue as it now stands.
 * Side effects: writes one file.
 *
 * Idempotent on the proposal's id, so a job that runs twice — a lost state
 * file, a restart at the wrong minute — leaves one entry rather than two.
 * Replaces rather than skips, because the second run's figures are the newer
 * ones.
 */
export async function enqueue(vault: Vault, proposal: Proposal): Promise<Proposal[]> {
	const queue = [proposal, ...(await pending(vault)).filter((p) => p.id !== proposal.id)].slice(0, KEEP);
	await save(vault, queue);
	return queue;
}

/**
 * Everything waiting, newest first.
 *
 * Inputs: the vault. Output: the proposals. Side effects: reads one file.
 *
 * A file this version cannot parse reads as an empty queue rather than
 * throwing, which is the same rule the timer follows: the state here is worth
 * less than the page that shows it.
 */
export async function pending(vault: Vault): Promise<Proposal[]> {
	const note = await vault.read(PENDING_PATH);
	if (!note.exists) return [];
	try {
		const parsed = JSON.parse(note.content) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(p): p is Proposal =>
				!!p && typeof p === 'object' && Array.isArray((p as Proposal).edits) && typeof (p as Proposal).feature === 'string'
		);
	} catch {
		return [];
	}
}

/** One waiting proposal by id, or null. */
export async function pendingById(vault: Vault, id: string): Promise<Proposal | null> {
	return (await pending(vault)).find((p) => p.id === id) ?? null;
}

/**
 * Take a proposal out of the queue, whether it was accepted or rejected.
 *
 * Inputs: the vault and the id. Output: whether there was anything to remove.
 * Side effects: writes one file.
 *
 * Removing something that is not there is success, not an error: two browser
 * tabs deciding the same proposal is a normal thing for one person to do.
 */
export async function dequeue(vault: Vault, id: string): Promise<boolean> {
	const queue = await pending(vault);
	const kept = queue.filter((p) => p.id !== id);
	if (kept.length === queue.length) return false;
	await save(vault, kept);
	return true;
}

async function save(vault: Vault, queue: Proposal[]): Promise<void> {
	const note = await vault.read(PENDING_PATH);
	await vault.write(PENDING_PATH, `${JSON.stringify(queue, null, '\t')}\n`, note.exists ? note.hash : undefined);
}
