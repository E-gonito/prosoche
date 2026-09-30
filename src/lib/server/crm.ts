/**
 * A workspace's CRM: its suppliers, stakeholders and leads, one note each in
 * `<home>/CRM/<Name>.md`, in the format `parse/contact.ts` defines.
 *
 * The one door the CRM routes use. It turns a workspace and a contact's name
 * into a path, reads and writes through the Vault, and guards every edit
 * with the content hash the caller last saw, so a change made in Obsidian or
 * on another device comes back as a conflict rather than being overwritten.
 *
 * Public scope only. A workspace whose home is under `Private/` has no CRM:
 * it lists nobody and refuses to create anyone, and nothing here ever asks
 * the Vault for private scope. Person notes elsewhere in the vault
 * (`people.ts`) are a different thing and are never read or written here.
 */

import { isDayKey, today, type DayKey } from './daily';
import {
	CONTACT_FIELDS,
	addHistoryEntry,
	contactName,
	newContact,
	parseContact,
	setContactField,
	type ContactDetails,
	type ContactField,
	type ContactInput,
	type HistoryEntry
} from './parse/contact';
import { basename } from './parse/note';
import { hashContent, type Note, type Vault } from './vault/index';
import { isPrivate } from './vault/paths';
import { homeFolder, type Workspace } from './workspaces';

export { CONTACT_KINDS } from './parse/contact';

/** The folder under a workspace's home that holds its contacts. */
const CRM_FOLDER = 'CRM';

/** Enough about a contact for the list. */
interface ContactSummary {
	/** The file name, which is also what `[[links]]` to the contact spell. */
	name: string;
	path: string;
	kind: string | null;
	company: string | null;
	role: string | null;
	/** The newest dated history entry, or null when there is none. */
	lastInteraction: DayKey | null;
	/** How many history entries the contact has, dated or not. */
	interactions: number;
}

/** Everything a contact's page shows, and the hash to send back with an edit. */
interface Contact extends ContactSummary, ContactDetails {
	/** Free notes: the body without its frontmatter or `## History`, as markdown. */
	notes: string;
	/** Newest first; entries without a date follow, in file order. */
	history: HistoryEntry[];
	hash: string;
}

type ContactWrite =
	| { ok: true; contact: Contact }
	| { ok: false; reason: 'bad-name' | 'exists' | 'missing' | 'conflict' | 'no-text' | 'bad-day' | 'private' };

/** What one edit may change: any of the fields, one new history entry, or both at once. */
export interface ContactChange {
	/** A field set to '' or [] is cleared. Keys that are not contact fields are ignored. */
	fields?: Partial<Record<ContactField, string | string[]>>;
	/** A new history entry; `day` defaults to today. */
	entry?: { day?: string; text: string };
}

/**
 * Every contact in a workspace, the most recent interaction first; contacts
 * with no history follow, by name. Reads each contact's note; writes nothing.
 * Only notes directly in the CRM folder count, so a subfolder of attachments
 * or archived contacts is not listed.
 */
export async function listContacts(vault: Vault, workspace: Workspace): Promise<ContactSummary[]> {
	const folder = `${crmFolder(workspace)}/`;
	const paths = (await vault.list()).filter((p) => p.startsWith(folder) && !p.slice(folder.length).includes('/'));
	const contacts = await Promise.all(paths.map(async (path) => toContact(await vault.read(path))));
	return contacts
		.map(({ name, path, kind, company, role, lastInteraction, interactions }) => ({ name, path, kind, company, role, lastInteraction, interactions }))
		.sort(byRecency);
}

/**
 * One contact by name, or null when the workspace has no such contact.
 *
 * Any name that is a file in the CRM folder is found, including one made in
 * Obsidian with characters `createContact` would refuse; only a name that
 * would reach outside the folder reads as missing. Writes nothing.
 */
export async function readContact(vault: Vault, workspace: Workspace, name: string): Promise<Contact | null> {
	const path = existingPath(workspace, name);
	if (!path) return null;
	const note = await vault.read(path);
	return note.exists ? toContact(note) : null;
}

/**
 * Create a contact's note from the new-contact form.
 *
 * Refuses a name that cannot be a file name or a wikilink (`bad-name`, see
 * `contactName`), one that matches an existing contact ignoring case
 * (`exists` — Obsidian resolves links without regard to case, so two such
 * files would be one contact to it), and any workspace whose home is private
 * (`private`). Never overwrites: a file that appears between the check and
 * the write is an `exists` too.
 */
export async function createContact(vault: Vault, workspace: Workspace, rawName: string, input: ContactInput = {}): Promise<ContactWrite> {
	const name = contactName(rawName);
	if (!name) return { ok: false, reason: 'bad-name' };
	const path = `${crmFolder(workspace)}/${name}.md`;
	if (isPrivate(path)) return { ok: false, reason: 'private' };

	const taken = (await listContacts(vault, workspace)).some((c) => c.name.toLowerCase() === name.toLowerCase());
	if (taken) return { ok: false, reason: 'exists' };

	const result = await vault.write(path, newContact(input), hashContent(''));
	if (!result.ok) return { ok: false, reason: 'exists' };
	return { ok: true, contact: toContact(result.note) };
}

/**
 * Apply one change to a contact's note and write it, if the note still has
 * the hash the caller read it with.
 *
 * Each field is a span edit of its own frontmatter lines, applied in
 * `CONTACT_FIELDS` order; the entry is one line inserted under `## History`
 * (see `addHistoryEntry`). Nothing else in the note changes. A change that
 * leaves the note as it was writes nothing and still succeeds.
 *
 * Refusals: `missing` for no such contact, `conflict` when the note changed
 * since `expectedHash` was read, `no-text` for an entry with no words, and
 * `bad-day` for an entry day that is not `YYYY-MM-DD`. A refusal writes
 * nothing at all, fields included.
 */
export async function updateContact(
	vault: Vault,
	workspace: Workspace,
	name: string,
	expectedHash: string,
	change: ContactChange
): Promise<ContactWrite> {
	const path = existingPath(workspace, name);
	const note = path ? await vault.read(path) : null;
	if (!note?.exists) return { ok: false, reason: 'missing' };
	if (note.hash !== expectedHash) return { ok: false, reason: 'conflict' };

	let content = note.content;
	for (const field of CONTACT_FIELDS) {
		const value = change.fields?.[field];
		if (typeof value === 'string' || (Array.isArray(value) && value.every((v) => typeof v === 'string'))) {
			content = setContactField(content, field, value);
		}
	}

	if (change.entry) {
		const day = change.entry.day ?? today();
		if (!isDayKey(day)) return { ok: false, reason: 'bad-day' };
		const added = addHistoryEntry(content, day, String(change.entry.text ?? ''));
		if (!added) return { ok: false, reason: 'no-text' };
		content = added.content;
	}

	if (content === note.content) return { ok: true, contact: toContact(note) };
	const result = await vault.write(note.path, content, note.hash);
	if (!result.ok) return { ok: false, reason: 'conflict' };
	return { ok: true, contact: toContact(result.note) };
}

function crmFolder(workspace: Workspace): string {
	return `${homeFolder(workspace)}/${CRM_FOLDER}`;
}

/** The path of a contact that may already exist, or null for a name that would leave the folder. */
function existingPath(workspace: Workspace, name: string): string | null {
	if (!name.trim() || /[\\/]/.test(name) || name.startsWith('.')) return null;
	return `${crmFolder(workspace)}/${name}.md`;
}

function toContact(note: Note): Contact {
	const parsed = parseContact(note.content);
	const dated = parsed.history.filter((h) => h.day !== null).sort((a, b) => b.day!.localeCompare(a.day!) || a.line - b.line);
	const history = [...dated, ...parsed.history.filter((h) => h.day === null)];
	return {
		...parsed,
		name: basename(note.path),
		path: note.path,
		lastInteraction: dated[0]?.day ?? null,
		interactions: history.length,
		history,
		hash: note.hash
	};
}

function byRecency(a: ContactSummary, b: ContactSummary): number {
	if (a.lastInteraction !== b.lastInteraction) {
		if (!a.lastInteraction) return 1;
		if (!b.lastInteraction) return -1;
		return b.lastInteraction.localeCompare(a.lastInteraction);
	}
	return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}
