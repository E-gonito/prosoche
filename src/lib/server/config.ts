/**
 * Every path and tunable the server needs, resolved once.
 *
 * Nothing else in the codebase reads process.env or hardcodes a directory, so
 * pointing the hub at a different vault is a one-line change here.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

export const config = {
	/** Absolute path to the Obsidian vault working copy. */
	vaultPath: process.env.HUB_VAULT ?? join(homedir(), 'vault'),
	/** Rebuildable search index. Deleting it is always safe. */
	dbPath: process.env.HUB_DB ?? join(homedir(), '.local/state/hub/index.db'),
	/** Undo snapshots taken before any AI-applied change. Never synced. */
	undoPath: process.env.HUB_UNDO ?? join(homedir(), '.local/state/hub/undo'),
	/** Folder inside the vault holding workspace definitions and hub settings. */
	hubFolder: '_hub',
	/**
	 * Folder inside the vault that only a private module may read or write.
	 * It is never indexed, listed, watched, searched or committed; see
	 * `isPrivate` in `vault/paths.ts`.
	 */
	privateFolder: 'Private',
	/**
	 * Folder at the vault root holding the glossaries, one file each, the file
	 * name being the glossary's name: `Glossaries/Computer Science.md`.
	 */
	glossaryFolder: 'Glossaries',

	git: {
		/** Wait this long after the last save before committing. */
		commitDebounceMs: 3 * 60 * 1000,
		/** How often to pull. */
		pullIntervalMs: 5 * 60 * 1000,
		branch: 'master'
	},

	/**
	 * Directories never read, indexed or watched. `.stversions` and `.stfolder`
	 * are Syncthing leftovers and `Excalidraw` holds large generated drawings;
	 * the vault's own CLAUDE.md says not to touch either.
	 */
	ignoredDirs: ['.git', '.obsidian', '.stversions', '.stfolder', '.venv', '__pycache__', 'node_modules', 'Excalidraw'],

	/**
	 * Daily notes live at Journal/YYYY/MM/DD.md. `tasksHeading` is the heading
	 * a day's plan sits under, and the one anything appending a block to a day
	 * writes beneath, so the vault's name for it is stated once here.
	 */
	dailyNote: {
		folder: 'Journal',
		template: 'Journal/Journal Template.md',
		tasksHeading: '# Tasks'
	},

	/**
	 * Where a person note goes when the hub creates one. The vault has no such
	 * folder yet, which is the point: people are found through the wikilinks
	 * already in the notes, and a note is only written when the user asks for
	 * one. This is where it lands.
	 */
	peopleFolder: process.env.HUB_PEOPLE_FOLDER ?? 'People',

	calendar: {
		/** Google Calendar "secret address in iCal format". Empty means no calendar. */
		icsUrl: process.env.HUB_GCAL_ICS ?? '',
		/** How long a fetched feed is reused before fetching again. */
		cacheTtlMs: 5 * 60 * 1000
	},

	/**
	 * Base URL of a T3 Code web client running on this machine, e.g. a
	 * tailnet address. Empty means not set up: the nav and palette entry are
	 * left out entirely rather than pointing somewhere that will not answer.
	 */
	t3Url: process.env.HUB_T3_URL ?? ''
} as const;
