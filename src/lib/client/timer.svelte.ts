/**
 * The browser's view of the one running timer.
 *
 * A single instance, exported from this module, so the header keeps counting
 * across a client-side navigation instead of restarting on every page. The
 * server remains the authority: this reconciles with it when the component
 * appears and whenever the tab comes back to the front, and only ticks the
 * display in between.
 *
 * The elapsed time is measured against the server's clock, not the browser's.
 * The difference is usually nothing, but a phone with a drifting clock would
 * otherwise show a timer that had run for minus two minutes.
 *
 * Every call reports its failure by leaving the state as it was. A timer whose
 * stop did not reach the server is still running, which is true, and pressing
 * stop again is safe.
 */

import { formatDuration, formatElapsed, type RunningTimer, type TimerState } from '$lib/shared/duration';

/** How long the "23m logged" confirmation stays up after a stop. */
const CONFIRM_MS = 6000;

class TimerClient {
	#timer = $state<RunningTimer | null>(null);
	#tick = $state(Date.now());
	#busy = $state(false);
	#logged = $state<TimerState['logged']>(null);
	/** Server clock minus browser clock, in milliseconds. */
	#skew = 0;
	#ticker: ReturnType<typeof setInterval> | null = null;
	#confirm: ReturnType<typeof setTimeout> | null = null;

	/** The task being timed, or null when nothing is running. */
	get task(): RunningTimer | null {
		return this.#timer;
	}

	get running(): boolean {
		return this.#timer !== null;
	}

	/** True while a request is in flight, so a button can refuse a double press. */
	get busy(): boolean {
		return this.#busy;
	}

	/** Seconds since the timer started, by the server's clock. */
	get seconds(): number {
		if (!this.#timer) return 0;
		return Math.max(0, Math.floor((this.#tick + this.#skew - Date.parse(this.#timer.startedAt)) / 1000));
	}

	/** Elapsed time as the header shows it: `7:04`, or `1:23:45` past an hour. */
	get elapsed(): string {
		return formatElapsed(this.seconds);
	}

	/** "23m logged to 2026-09-21" for a few seconds after a stop, else null. */
	get confirmation(): string | null {
		return this.#logged ? `${formatDuration(this.#logged.minutes)} logged` : null;
	}

	/**
	 * Reconcile with the server and keep the display ticking. Call from an
	 * effect in the component that shows the timer; the returned function
	 * detaches it. Idempotent, so two components mounting is not two tickers.
	 */
	attach(): () => void {
		void this.refresh();
		const wake = () => {
			if (document.visibilityState === 'visible') void this.refresh();
		};
		document.addEventListener('visibilitychange', wake);
		return () => {
			document.removeEventListener('visibilitychange', wake);
			this.#stopTicking();
		};
	}

	/** Ask the server what is running. */
	async refresh(): Promise<void> {
		await this.#send(() => fetch('/api/timer'));
	}

	/** Start timing a task line. Whatever was running is stopped and logged. */
	async start(path: string, line: number): Promise<void> {
		await this.#send(() => this.#post({ action: 'start', path, line }));
	}

	/** Stop and log. Safe when nothing is running. */
	async stop(): Promise<void> {
		await this.#send(() => this.#post({ action: 'stop' }));
	}

	#post(body: unknown): Promise<Response> {
		return fetch('/api/timer', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	async #send(request: () => Promise<Response>): Promise<void> {
		this.#busy = true;
		try {
			const response = await request();
			if (response.ok) this.#apply((await response.json()) as TimerState);
		} catch {
			// Offline, or the server restarting. The last known state is still the
			// best guess, and the next refresh will correct it.
		} finally {
			this.#busy = false;
		}
	}

	#apply(state: TimerState): void {
		this.#skew = Date.parse(state.now) - Date.now();
		this.#timer = state.timer;
		this.#tick = Date.now();
		if (state.logged) this.#confirmFor(state.logged);
		if (state.timer) this.#startTicking();
		else this.#stopTicking();
	}

	#confirmFor(logged: TimerState['logged']): void {
		this.#logged = logged;
		if (this.#confirm) clearTimeout(this.#confirm);
		this.#confirm = setTimeout(() => (this.#logged = null), CONFIRM_MS);
	}

	#startTicking(): void {
		if (this.#ticker) return;
		this.#ticker = setInterval(() => (this.#tick = Date.now()), 1000);
	}

	#stopTicking(): void {
		if (this.#ticker) clearInterval(this.#ticker);
		this.#ticker = null;
	}
}

/**
 * The one timer. Created when the module loads, which on the server means an
 * instance per process that nothing ever populates: `attach` is the only thing
 * that talks to the API and it only runs in the browser.
 */
export const timer = new TimerClient();
