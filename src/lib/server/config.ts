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

	/** Daily notes live at Journal/YYYY/MM/DD.md. */
	dailyNote: { folder: 'Journal', format: 'YYYY/MM/DD', template: 'Journal/Journal Template.md' },

	/**
	 * Where a person note goes when the hub creates one. The vault has no such
	 * folder yet, which is the point: people are found through the wikilinks
	 * already in the notes, and a note is only written when the user asks for
	 * one. This is where it lands.
	 */
	peopleFolder: process.env.HUB_PEOPLE_FOLDER ?? 'People',

	/**
	 * Where the read-only work timesheet lives. One note per month, named
	 * `TIMESHEET <MONTH>`, though not always exactly — a suffix after the month
	 * is common — so the hub matches on the prefix and never computes a file
	 * name from the date.
	 */
	timesheet: {
		folder: process.env.HUB_TIMESHEET_FOLDER ?? 'Work/Atlas',
		filePrefix: 'TIMESHEET'
	},

	/**
	 * Integration credentials, read from the environment so no token is ever
	 * written into the vault or the repository. Absent is the expected case:
	 * each integration renders a "not connected" card naming the variable to
	 * set, and the hub works without either one.
	 */
	github: {
		/** Fine-grained or classic token with read access to issues and pull requests. */
		token: process.env.HUB_GITHUB_TOKEN ?? '',
		/** Optional `owner/name` filter, comma separated. Empty means every repo the token can see. */
		repos: splitList(process.env.HUB_GITHUB_REPOS),
		/** Overridable so a test can point at a stub instead of github.com. */
		api: process.env.HUB_GITHUB_API ?? 'https://api.github.com',
		cacheTtlMs: 2 * 60 * 1000
	},
	linear: {
		/** Personal API key from Linear's settings. Sent as-is, not as a Bearer token. */
		token: process.env.HUB_LINEAR_TOKEN ?? '',
		api: process.env.HUB_LINEAR_API ?? 'https://api.linear.app/graphql',
		cacheTtlMs: 2 * 60 * 1000
	}
} as const;

/** `a, b` to `['a','b']`, with an unset or empty variable meaning no filter. */
function splitList(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
}
