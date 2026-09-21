/**
 * Creating a day's note.
 *
 * The vault's daily notes are copies of `Journal/Journal Template.md` with
 * times filled in afterwards. The hub follows that: the first write to a day
 * that has no note creates it from the template, unchanged, so the day starts
 * with the same checklist Obsidian would have given it.
 *
 * The template is copied verbatim on purpose. It contains a stale heading and
 * its own quirks; silently "fixing" those would be the app editing the user's
 * writing rather than their plan.
 */

import { config } from './config';
import { dailyNotePath, type DayKey } from './daily';
import type { Note, Vault } from './vault/index';

/** Read a day's note, creating it from the template if it is missing. */
export async function openDay(vault: Vault, day: DayKey): Promise<Note> {
	const path = dailyNotePath(day);
	const existing = await vault.read(path);
	if (existing.exists) return existing;

	const template = await vault.read(config.dailyNote.template);
	const result = await vault.write(path, template.exists ? template.content : emptyDay());
	return result.ok ? result.note : existing;
}

/**
 * Whether a day's note exists yet, without creating it. Used by views that
 * must not have a side effect: opening tomorrow to look at it should not
 * write a file.
 */
export async function dayExists(vault: Vault, day: DayKey): Promise<boolean> {
	return (await vault.read(dailyNotePath(day))).exists;
}

/** Fallback when the vault has no template, so a day is never unusable. */
function emptyDay(): string {
	return '# Tasks\n\n';
}
