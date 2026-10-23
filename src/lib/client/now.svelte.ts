/**
 * The browser's half of the now strip: a clock that ticks against the
 * server's, the reloads that keep the strip true, and the tab title.
 *
 * One of these runs per page (the layout starts it), however many strips are
 * drawn: the rail's and the phone's are both just views of `at` and the
 * layout's `now` data. It owns three things:
 *
 * - `at`: the server's idea of now, in epoch milliseconds, advanced every
 *   second from the device's clock plus the skew measured when the data
 *   arrived (as `/focus` does). 0 until it first ticks, so server rendering
 *   and the first paint use the data's own `serverNow` and agree.
 * - Reloads of `prosoche:now` (the layout's tag for the strip alone): every
 *   minute, when the tab becomes visible again, and the moment a soon strip
 *   reaches its start so it flips to due without waiting for the minute.
 * - The tab title: the page's own title with the strip's prefix in front
 *   (`▶ 23:41 · ` while running, `Due: <text> · ` while due). Pages set their
 *   titles themselves, so this takes the last prefix off before putting the
 *   new one on, and re-applies whenever anything in `<head>` changes, which
 *   is how it survives a page setting its title without fighting it. It
 *   stays off the `/focus` page, which manages its own title.
 *
 * Nothing here decides what the strip says; `stripView` does.
 */

import { untrack } from 'svelte';
import { invalidate } from '$app/navigation';
import { prefixed, stripView, type NowStrip } from '$lib/shared/focus-now';

/** The dependency tag the root layout loader registers for `now`. */
export const NOW_TAG = 'prosoche:now';

const POLL_MS = 60_000;
/** A soon strip that reached its start is reloaded at most this often, so a server a hair behind us is not hammered. */
const FLIP_RETRY_MS = 3_000;

class NowState {
	/** The server's now in epoch ms, ticking; 0 before the first tick. */
	at = $state(0);
	/** Whether the title may be prefixed: false on the `/focus` page. */
	titles = $state(true);

	private strip = $state.raw<NowStrip | null>(null);
	private skew = 0;
	private ticking = false;
	private applied = '';
	private lastFlip = 0;

	/** Take the layout's strip. Measures the device clock's skew against its `serverNow`. */
	set(strip: NowStrip | null) {
		this.strip = strip;
		this.skew = strip ? strip.serverNow - Date.now() : 0;
		if (this.ticking) this.at = Date.now() + this.skew;
	}

	private view() {
		return this.strip ? stripView(this.strip, this.at || this.strip.serverNow) : null;
	}

	/**
	 * Put the strip's prefix on `document.title`, or take it off. Reads `at`
	 * and `titles`, so called from an `$effect` it re-runs every tick and on
	 * navigation to and from `/focus`. Idempotent; safe to call any time.
	 */
	syncTitle() {
		const prefix = this.titles ? (this.view()?.titlePrefix ?? '') : '';
		const next = prefixed(document.title, this.applied, prefix);
		this.applied = prefix;
		if (next !== document.title) document.title = next;
	}

	/** Start ticking, polling and watching the title. Call once, in the browser. Returns the function that stops it all. */
	start(): () => void {
		const reload = () => void invalidate(NOW_TAG);
		const tick = () => {
			this.at = Date.now() + this.skew;
			const flipAt = this.view()?.flipAt;
			if (flipAt && this.at >= flipAt && Date.now() - this.lastFlip > FLIP_RETRY_MS) {
				this.lastFlip = Date.now();
				reload();
			}
		};
		const visible = () => {
			if (document.visibilityState !== 'visible') return;
			tick();
			reload();
		};
		this.ticking = true;
		// Called from an effect: the first tick must not make that effect depend on the clock.
		untrack(tick);
		const ticker = setInterval(tick, 1000);
		const poller = setInterval(reload, POLL_MS);
		document.addEventListener('visibilitychange', visible);
		// A page setting its own title changes <head>; put the prefix back.
		const heads = new MutationObserver(() => this.syncTitle());
		heads.observe(document.head, { subtree: true, childList: true, characterData: true });
		return () => {
			clearInterval(ticker);
			clearInterval(poller);
			document.removeEventListener('visibilitychange', visible);
			heads.disconnect();
			this.ticking = false;
		};
	}
}

export const now = new NowState();
