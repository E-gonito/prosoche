/**
 * Every path and tunable the server needs, resolved once.
 *
 * Nothing else in the codebase reads process.env or hardcodes a directory, so
 * pointing the hub at a different vault is a one-line change here.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** What `HUB_VAPID_*` asked for: nothing, a working setup, or a mistake. */
export type PushConfig =
	| { state: 'off' }
	| { state: 'on'; publicKey: string; privateKey: string; subject: string }
	| { state: 'invalid'; problem: string };

/** URL-safe base64 (the form `web-push generate-vapid-keys` prints) and how many bytes it must decode to. */
function vapidKey(value: string, bytes: number): boolean {
	return /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value, 'base64url').length === bytes;
}

/**
 * Read the Web Push settings out of an environment.
 *
 * Inputs: `HUB_VAPID_PUBLIC`, `HUB_VAPID_PRIVATE` and `HUB_VAPID_SUBJECT`
 * (a `mailto:` or `https:` address the push services can contact). Output:
 * `off` when none of the keys is set, `on` when both keys and a subject are
 * set and well formed, and otherwise `invalid` with a sentence saying what to
 * fix. Blank counts as unset. Never throws and never returns a half-working
 * setup: one key without the other, a subject that is neither `mailto:` nor
 * `https:`, or a key of the wrong length is `invalid`, so push is never
 * quietly off because of a typo. Pure.
 */
export function readPushConfig(env: Record<string, string | undefined>): PushConfig {
	const publicKey = env.HUB_VAPID_PUBLIC?.trim() ?? '';
	const privateKey = env.HUB_VAPID_PRIVATE?.trim() ?? '';
	const subject = env.HUB_VAPID_SUBJECT?.trim() ?? '';
	if (!publicKey && !privateKey) {
		return subject
			? { state: 'invalid', problem: 'HUB_VAPID_SUBJECT is set but HUB_VAPID_PUBLIC and HUB_VAPID_PRIVATE are not. Set both keys, or unset the subject.' }
			: { state: 'off' };
	}
	if (!publicKey || !privateKey) {
		const missing = publicKey ? 'HUB_VAPID_PRIVATE' : 'HUB_VAPID_PUBLIC';
		return { state: 'invalid', problem: `${missing} is not set. Push needs both HUB_VAPID_PUBLIC and HUB_VAPID_PRIVATE; make them with: npx web-push generate-vapid-keys` };
	}
	if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s/]+.*)$/.test(subject)) {
		return { state: 'invalid', problem: 'HUB_VAPID_SUBJECT must be a mailto: or https: address, such as mailto:you@example.com. The push services require one.' };
	}
	if (!vapidKey(publicKey, 65)) return { state: 'invalid', problem: 'HUB_VAPID_PUBLIC is not a VAPID public key. Make a pair with: npx web-push generate-vapid-keys' };
	if (!vapidKey(privateKey, 32)) return { state: 'invalid', problem: 'HUB_VAPID_PRIVATE is not a VAPID private key. Make a pair with: npx web-push generate-vapid-keys' };
	return { state: 'on', publicKey, privateKey, subject };
}

export const config = {
	/** Absolute path to the Obsidian vault working copy. */
	vaultPath: process.env.HUB_VAULT ?? join(homedir(), 'vault'),
	/** Rebuildable search index. Deleting it is always safe. */
	dbPath: process.env.HUB_DB ?? join(homedir(), '.local/state/hub/index.db'),
	/** Undo snapshots taken before any AI-applied change. Never synced. */
	undoPath: process.env.HUB_UNDO ?? join(homedir(), '.local/state/hub/undo'),
	/**
	 * Where Claude Code caches the models it offers, refreshed by the CLI
	 * itself. Read so the AI settings pick up a new model without a release;
	 * see `ai/models.ts`.
	 */
	claudeCatalogPath: process.env.HUB_CLAUDE_CATALOG ?? join(homedir(), '.claude/cache/model-catalog'),
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
	/**
	 * Folder at the vault root holding each glossary's flashcards, one folder
	 * per glossary: `Flashcards/Computer Science/Cloud.md`. It is shared with
	 * the `.txt` decks another tool generates, so only `.md` files in it are
	 * prosoche's.
	 */
	flashcardFolder: 'Flashcards',
	/**
	 * Folder at the vault root holding the tactics trainer's notes:
	 * `Scenarios/<id>.md`, one drill each, and `Attempts/<YYYY-MM>.md`, the
	 * log of every answer, which is the trainer's only state.
	 */
	tacticsFolder: 'Tactics',

	git: {
		/**
		 * Wait this long after the last save before committing; each save
		 * restarts the wait, so a burst of saves, like a review session, is
		 * one commit. Short, so an edit reaches Obsidian on the Mac, which
		 * commits five minutes after its own last edit, before either side
		 * edits the same file again.
		 */
		commitDebounceMs: 60 * 1000,
		/** How often to pull, for the same reason. */
		pullIntervalMs: 60 * 1000,
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
	t3Url: process.env.HUB_T3_URL ?? '',

	/**
	 * Web Push for nudges, from `HUB_VAPID_PUBLIC`, `HUB_VAPID_PRIVATE` and
	 * `HUB_VAPID_SUBJECT`; see `readPushConfig`. Unset means push is off. A
	 * mistake does not stop the server (it would take the planner down for
	 * an optional feature): it is carried as `invalid`, and `notify.ts`
	 * reports it in Settings and in the log.
	 */
	push: readPushConfig(process.env)
} as const;
