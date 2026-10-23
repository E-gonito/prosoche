/**
 * The "now strip": the one line the shell shows on every page about what the
 * author is doing or is about to. The server decides WHICH state (see
 * `server/focus/now.ts`); this file holds the type that crosses to the
 * browser and the pure arithmetic that turns it, at an instant, into words,
 * so the component only draws and the arithmetic is table-tested. Shared
 * because a component must not import `$server`.
 */

import { justMinutes } from './focus';
import { formatMinutes } from './time';
import { isOpen, type Task } from './task';

/** One block named by a due or soon strip. */
export interface NowBlock {
	/** 0-based line of the task in the day's note. */
	line: number;
	/** The task's words without times or quadrant. */
	text: string;
	startMin: number;
	endMin: number;
}

/**
 * What the strip shows, or (as `null` where this is used) nothing at all.
 *
 * `serverNow` is the server's epoch milliseconds when this was made: the
 * browser's clock may be off, so every countdown is measured against it
 * (`serverNow - Date.now()` at load is the skew). `startAt` is the server's
 * epoch milliseconds for `startMin` on `day`, so a countdown to it needs no
 * time zone on the device.
 */
export type NowStrip =
	| {
			state: 'running';
			name: string;
			/** Epoch milliseconds the timer started. */
			startedAt: number;
			/** Planned length in minutes. */
			minutes: number;
			warmupMin: number;
			serverNow: number;
	  }
	| {
			state: 'due' | 'soon';
			day: string;
			/** Minutes since midnight. Shared by every block listed. */
			startMin: number;
			startAt: number;
			/** The blocks starting at `startMin`, in file order; more than one is a same-start group. */
			blocks: NowBlock[];
			serverNow: number;
	  };

/** `m:ss` for a span, rounding up while counting down and down while counting up, signed `+` once over. Pure. */
export function clockText(ms: number): string {
	const s = ms >= 0 ? Math.ceil(ms / 1000) : Math.floor(-ms / 1000);
	return `${ms < 0 ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What to draw for a strip at one instant. */
export interface StripView {
	state: NowStrip['state'];
	/** Where the whole line goes. */
	href: string;
	/** The words: a block's text, the group's `18:00 · A, B`, or the session's name. */
	label: string;
	/** What follows the label after a ` · `: a countdown, time left or how long ago. Null for none. */
	detail: string | null;
	/** True when a running session is past its time, so the detail is drawn in the warning colour. */
	over: boolean;
	/** Where a separate Start button goes; null when the strip has none (running, soon). */
	start: string | null;
	/** Epoch ms a soon strip flips to due, else null: the cue to reload it. */
	flipAt: number | null;
	/** What the tab title is prefixed with, `''` for nothing. Includes its trailing separator. */
	titlePrefix: string;
}

/** A link to start one block of `day`'s note. Pure. */
export const startHref = (day: string, line: number) => `/focus/start?day=${day}&line=${line}`;

/**
 * Words and links for `strip` at `now` (epoch ms, already corrected for the
 * device's clock skew). Pure; the same inputs give the same view.
 *
 * Running shows the session's name and its time left, or, in the warm-up, the
 * warm-up promise and its countdown; past the end the detail is `+m:ss` and
 * `over` is set. A due strip says how long ago the block started and offers
 * Start; a same-start group is one line `18:00 · A, B` whose Start goes to
 * Today, which has a Start per block. A soon strip counts down to the start
 * and links to the block's start page.
 */
export function stripView(strip: NowStrip, now: number): StripView {
	if (strip.state === 'running') {
		const warmLeft = strip.startedAt + strip.warmupMin * 60_000 - now;
		const left = strip.startedAt + strip.minutes * 60_000 - now;
		const clock = clockText(warmLeft > 0 ? warmLeft : left);
		const over = warmLeft <= 0 && left < 0;
		return {
			state: 'running',
			href: '/focus',
			label: warmLeft > 0 ? justMinutes(strip.warmupMin) : strip.name,
			detail: warmLeft > 0 || over ? clock : `${clock} left`,
			over,
			start: null,
			flipAt: null,
			titlePrefix: `▶ ${clock} · `
		};
	}
	const group = strip.blocks.length > 1;
	const one = strip.blocks[0];
	const label = group ? `${formatMinutes(strip.startMin)} · ${strip.blocks.map((b) => b.text).join(', ')}` : one.text;
	const href = group ? '/today' : startHref(strip.day, one.line);
	if (strip.state === 'soon') {
		return { state: 'soon', href, label, detail: `in ${clockText(strip.startAt - now)}`, over: false, start: null, flipAt: strip.startAt, titlePrefix: '' };
	}
	const ago = Math.floor((now - strip.startAt) / 60_000);
	return {
		state: 'due',
		href,
		label,
		detail: group ? null : ago < 1 ? 'started just now' : `started ${ago} min ago`,
		over: false,
		start: href,
		flipAt: null,
		titlePrefix: `Due: ${label} · `
	};
}

/**
 * `title` with `prefix` in front of the page's own words. `applied` is the
 * prefix this function put there last time: it is taken off first, so a title
 * is never prefixed twice and a page that has since set a new title (which has
 * no prefix) is left alone. Returns the title to show. Pure.
 */
export function prefixed(title: string, applied: string, prefix: string): string {
	const base = applied && title.startsWith(applied) ? title.slice(applied.length) : title;
	return prefix + base;
}

/**
 * The link that starts `task` from Today, or null when it cannot be started
 * there: it must be open, have a start and a later end, live in the viewed
 * day's own note (`task.path === dayPath`) and the day must be today. Pure.
 */
export function startLink(task: Task, day: string | undefined, dayPath: string | undefined, isToday: boolean): string | null {
	if (!isToday || !day || task.path !== dayPath || !isOpen(task)) return null;
	if (task.startMin === null || task.endMin === null || task.endMin <= task.startMin) return null;
	return startHref(day, task.line);
}
