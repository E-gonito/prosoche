/**
 * Which of the rail's groups are folded: a module's sub-items (the
 * glossaries under Glossary, the workspaces under Workspaces) hidden behind
 * its chevron.
 *
 * Like the theme, the choice belongs to the device rather than the vault, so
 * it lives in localStorage under `STORAGE_KEY`, as a list of module ids.
 * Every group starts open. Off the browser nothing is folded, so the server's
 * render shows every group and the browser folds the chosen ones on start.
 */

const STORAGE_KEY = 'hub:rail-folded';

class RailState {
	/** The ids of the folded modules. */
	folded = $state<string[]>([]);

	/** Read the saved choice. Call once, in the browser. */
	start() {
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
			this.folded = Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
		} catch {
			this.folded = [];
		}
	}

	isFolded(id: string): boolean {
		return this.folded.includes(id);
	}

	/** Fold an open group or open a folded one, and remember it on this device. */
	toggle(id: string) {
		this.folded = this.isFolded(id) ? this.folded.filter((f) => f !== id) : [...this.folded, id];
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.folded));
		} catch {
			// Storage full or blocked: the fold still holds until the page reloads.
		}
	}
}

export const rail = new RailState();
