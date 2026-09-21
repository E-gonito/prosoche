/**
 * The command palette's state and the commands it runs.
 *
 * One object owns the box: whether it is open, what has been typed, what came
 * back, which row is selected, and whether a command is waiting for a word
 * from the user. The component that draws it holds no state of its own, which
 * is what lets the same palette be opened by a key, by a command, or by a
 * shared link arriving from the phone.
 *
 * Two rules shape the interface. Everything is reachable from the keyboard:
 * arrows move, Enter chooses, Escape steps back one level and then closes.
 * And nothing traps: Escape always leaves, a command that needs a word asks
 * for it in the same box, and a failed request becomes a line of text in the
 * palette rather than a dialog to dismiss.
 */

import { goto } from '$app/navigation';
import { fuzzyParts, fuzzySort } from '$lib/shared/fuzzy';
import { captureText, saveNote } from '$lib/client/api';
import { all, register, listen, type Shortcut } from '$lib/client/shortcuts.svelte';

export interface PaletteRow {
	id: string;
	/** Heading this row appears under. */
	group: string;
	title: string;
	/** Second line: a path, a quadrant, a key binding. */
	hint: string;
	/** Key binding to draw on the right, or ''. */
	keys: string;
	/** The title split into matched and unmatched runs, for highlighting. */
	parts: Array<{ text: string; hit: boolean }>;
	href: string | null;
	run: (() => void) | null;
}

/** A command that needs one word before it can run. */
interface Ask {
	title: string;
	placeholder: string;
	/** Returns the line to show afterwards. Throwing is not expected. */
	submit: (text: string) => Promise<string>;
}

interface VaultRows {
	notes: Array<{ path: string; title: string; snippet: string }>;
	tasks: Array<{ path: string; line: number; text: string; quadrant: number | null; positions: number[] }>;
	workspaces: Array<{ slug: string; name: string; color: string; positions: number[] }>;
}

const EMPTY: VaultRows = { notes: [], tasks: [], workspaces: [] };

/** How long to wait after a keystroke before asking the server. */
const DEBOUNCE_MS = 120;

const noteHref = (path: string) => `/notes/${path.split('/').map(encodeURIComponent).join('/')}`;

class PaletteState {
	open = $state(false);
	query = $state('');
	selected = $state(0);
	/** Set while a command is asking for a word. */
	ask = $state<Ask | null>(null);
	askText = $state('');
	/** One line of feedback: what was saved, or what went wrong. */
	message = $state('');
	busy = $state(false);

	private vault = $state<VaultRows>(EMPTY);
	private timer: ReturnType<typeof setTimeout> | null = null;
	/** Guards against an older request landing after a newer one. */
	private generation = 0;

	/** Commands first: they are what the box is for, and they are instant. */
	readonly rows: PaletteRow[] = $derived([
		...fuzzySort(this.query, all().filter((s) => s.description), (s) => s.description).map(({ item, match }) =>
			row({
				id: `command:${item.description}`,
				group: 'Commands',
				title: item.description,
				hint: '',
				keys: item.keys,
				positions: match.positions,
				run: item.run
			})
		),
		...this.vault.workspaces.map((w) =>
			row({
				id: `workspace:${w.slug}`,
				group: 'Workspaces',
				title: w.name,
				hint: `/w/${w.slug}`,
				positions: w.positions,
				href: `/w/${w.slug}`
			})
		),
		...this.vault.notes.map((n) =>
			row({ id: `note:${n.path}`, group: 'Notes', title: n.title, hint: n.snippet || n.path, href: noteHref(n.path) })
		),
		...this.vault.tasks.map((t) =>
			row({
				id: `task:${t.path}:${t.line}`,
				group: 'Tasks',
				title: t.text,
				hint: `${t.quadrant ? `Q${t.quadrant} · ` : ''}${t.path}`,
				positions: t.positions,
				href: noteHref(t.path)
			})
		)
	]);

	/**
	 * Register the commands and start listening for keys. Call once, from the
	 * one component that draws the palette; the returned function undoes both.
	 */
	install(): () => void {
		const off = register(commands(this));
		const stop = listen();
		return () => {
			off();
			stop();
		};
	}

	/** Open on the command list, with the box empty and the first row chosen. */
	show(query = ''): void {
		this.open = true;
		this.ask = null;
		this.message = '';
		this.setQuery(query);
	}

	close(): void {
		this.open = false;
		this.ask = null;
		this.askText = '';
		this.message = '';
	}

	toggle(): void {
		if (this.open) this.close();
		else this.show();
	}

	/** Type into the box. The vault is asked after a pause, not per keystroke. */
	setQuery(value: string): void {
		this.query = value;
		this.selected = 0;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.load(), DEBOUNCE_MS);
	}

	/** Move the selection, wrapping, so holding one arrow key always works. */
	move(delta: number): void {
		const count = this.rows.length;
		if (!count) return;
		this.selected = (this.selected + delta + count) % count;
	}

	/** Run the selected row: follow its link, or do the thing it does. */
	choose(): void {
		const row = this.rows[this.selected];
		if (!row) return;
		if (row.href) {
			const href = row.href;
			this.close();
			void goto(href);
			return;
		}
		row.run?.();
	}

	/**
	 * Escape: leave a question first, close the palette second. Never leaves
	 * the user somewhere they cannot get out of with one more press.
	 */
	back(): void {
		if (this.ask) {
			this.ask = null;
			this.askText = '';
			return;
		}
		this.close();
	}

	/** Switch the box into asking for a word for `ask`, opening it if needed. */
	request(ask: Ask): void {
		this.open = true;
		this.ask = ask;
		this.askText = '';
		this.message = '';
	}

	/** Answer the pending question. An empty answer is a no-op, not an error. */
	async answer(): Promise<void> {
		const ask = this.ask;
		const text = this.askText.trim();
		if (!ask || !text || this.busy) return;
		this.busy = true;
		this.message = await ask.submit(text);
		this.busy = false;
		this.ask = null;
		this.askText = '';
	}

	/** Ask the server what the vault has for the current query. */
	private async load(): Promise<void> {
		const mine = ++this.generation;
		try {
			const response = await fetch(`/api/palette?q=${encodeURIComponent(this.query)}`);
			const body = (await response.json()) as VaultRows;
			if (mine !== this.generation) return;
			this.vault = { notes: body.notes ?? [], tasks: body.tasks ?? [], workspaces: body.workspaces ?? [] };
		} catch {
			if (mine === this.generation) this.vault = EMPTY;
		}
	}
}

function row(parts: {
	id: string;
	group: string;
	title: string;
	hint: string;
	keys?: string;
	positions?: number[];
	href?: string;
	run?: () => void;
}): PaletteRow {
	return {
		id: parts.id,
		group: parts.group,
		title: parts.title,
		hint: parts.hint,
		keys: parts.keys ?? '',
		parts: fuzzyParts(parts.title, parts.positions ?? []),
		href: parts.href ?? null,
		run: parts.run ?? null
	};
}

/**
 * The commands, and the keys that reach them without the palette.
 *
 * They are registered as shortcuts even when they have no binding, so one
 * registry answers both questions the app has about a command: what key runs
 * it, and what to show in the list.
 */
function commands(palette: PaletteState): Shortcut[] {
	const go = (href: string) => () => {
		palette.close();
		void goto(href);
	};

	return [
		// The only binding that works while typing: it is a chord, so it cannot
		// be part of anything the user is writing.
		{ keys: 'mod+k', description: 'Command palette', group: 'Commands', whileTyping: true, run: () => palette.toggle() },
		{ keys: 't', description: 'Go to Today', group: 'Go', run: go('/') },
		{ keys: 's', description: 'Search notes', group: 'Go', run: go('/search') },
		{ keys: 'g', description: 'Go to Notes', group: 'Go', run: go('/notes') },
		{ keys: 'y', description: 'Go to Sync', group: 'Go', run: go('/sync') },
		{ keys: 'a', description: 'Ask your notes', group: 'Go', run: go('/ask') },
		{ keys: 'd', description: 'Go to Study', group: 'Go', run: go('/study') },
		// No single key. Review is where things wait rather than somewhere you
		// go repeatedly, and the letters left are worth more elsewhere.
		{ keys: '', description: 'Review waiting changes', group: 'Go', run: go('/review') },
		{ keys: '', description: 'AI settings', group: 'Go', run: go('/settings/ai') },
		{
			keys: 'c',
			description: 'Quick capture',
			group: 'Write',
			run: () =>
				palette.request({
					title: 'Quick capture',
					placeholder: 'Thought, link or task…',
					submit: async (text) => {
						const result = await captureText(text);
						return result.ok ? `Saved to ${result.value.path}` : result.message;
					}
				})
		},
		{
			keys: 'k',
			description: 'New card',
			group: 'Write',
			// A card is an ordinary task line, so capture writes it: the line
			// lands in the inbox with a quadrant and stays a task wherever it
			// is filed afterwards.
			run: () =>
				palette.request({
					title: 'New card',
					placeholder: 'What needs doing?',
					submit: async (text) => {
						const result = await captureText(`- [ ] ${text} \`Q2\``);
						return result.ok ? `Card written to ${result.value.path}` : result.message;
					}
				})
		},
		{
			keys: 'n',
			description: 'New note',
			group: 'Write',
			run: () =>
				palette.request({
					title: 'New note',
					placeholder: 'Note name…',
					submit: async (name) => {
						const path = `Inbox/${name.replace(/[\\/:*?"<>|]/g, '-')}.md`;
						// An existing note is not an error: the write is refused
						// and the user is taken to what is already there.
						const result = await saveNote(path, `# ${name}\n\n`, '');
						palette.close();
						void goto(noteHref(path));
						return result.ok ? `Created ${path}` : `${path} already exists`;
					}
				})
		},
		{
			keys: '[',
			description: 'Toggle sidebar',
			group: 'View',
			// The sidebar's collapsed state belongs to the layout, so the
			// command presses the layout's own button rather than keeping a
			// second copy of the answer.
			run: () => document.querySelector<HTMLButtonElement>('header button[aria-expanded]')?.click()
		},
		{
			keys: '',
			description: 'Rebuild index',
			group: 'View',
			run: async () => {
				palette.busy = true;
				try {
					const response = await fetch('/api/sync', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ action: 'rebuild' })
					});
					const body = (await response.json()) as { tookMs?: number };
					palette.message = `Index rebuilt in ${body.tookMs ?? '?'} ms`;
				} catch {
					palette.message = 'Could not reach the server.';
				}
				palette.busy = false;
			}
		}
	];
}

/** The one palette. A second would fight the first for the keyboard. */
export const palette = new PaletteState();
