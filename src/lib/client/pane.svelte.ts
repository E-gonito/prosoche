/**
 * A pane whose width and collapsed state survive a reload.
 *
 * The sizing rules live in `$lib/shared/panes`; this only adds reactivity and
 * storage. Kept as a class so a page can declare several panes without
 * repeating the persistence.
 */

import { clampPane, paneKey, resolveDrag, type PaneLimits } from '$lib/shared/panes';

export class Pane {
	#width = $state(0);
	#collapsed = $state(false);

	constructor(
		readonly name: string,
		readonly limits: PaneLimits,
		defaultWidth: number
	) {
		this.#width = clampPane(defaultWidth, limits);
	}

	get width(): number {
		return this.#width;
	}

	get collapsed(): boolean {
		return this.#collapsed;
	}

	/** Width to render: zero when collapsed. */
	get rendered(): number {
		return this.#collapsed ? 0 : this.#width;
	}

	/** Read the stored values. Call once the browser is available. */
	restore(): void {
		const width = Number(localStorage.getItem(paneKey(this.name, 'width')));
		if (Number.isFinite(width) && width > 0) this.#width = clampPane(width, this.limits);
		this.#collapsed = localStorage.getItem(paneKey(this.name, 'collapsed')) === '1';
	}

	/** Resize from a drag, collapsing instead if it went far enough. */
	resize(width: number): void {
		const next = resolveDrag(width, this.limits);
		this.#collapsed = next.collapsed;
		this.#width = next.width;
		this.#save();
	}

	/** Nudge from the keyboard. Never collapses, so a key cannot hide a pane. */
	nudge(delta: number): void {
		if (this.#collapsed) return;
		this.#width = clampPane(this.#width + delta, this.limits);
		this.#save();
	}

	toggle(): void {
		this.#collapsed = !this.#collapsed;
		this.#save();
	}

	#save(): void {
		try {
			localStorage.setItem(paneKey(this.name, 'width'), String(this.#width));
			localStorage.setItem(paneKey(this.name, 'collapsed'), this.#collapsed ? '1' : '0');
		} catch {
			// Private browsing, a full quota: the layout still works, it just
			// forgets. Not worth failing a render over.
		}
	}
}
