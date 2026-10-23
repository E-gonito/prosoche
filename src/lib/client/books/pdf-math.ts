/**
 * The arithmetic of a virtualised page stack, kept apart from the DOM so it
 * can be table-tested: where each page sits, which are on screen, which is
 * "the" current one, which to keep drawn, and how to keep the same spot under
 * the thumb when the scale changes.
 *
 * All positions are CSS pixels down the scroll content. A stack has `n`
 * pages of known `heights`, `gap` apart, with `pad` above the first and below
 * the last. Everything here is pure and never throws.
 */

/** Smallest and largest zoom, as a multiple of fit-to-width. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;

/** Clamp `value` into `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** The top of each page: the first at `pad`, each next one a `gap` under the last. */
export function layoutPages(heights: readonly number[], gap: number, pad: number): number[] {
	const offsets: number[] = [];
	let y = pad;
	for (const h of heights) {
		offsets.push(y);
		y += h + gap;
	}
	return offsets;
}

/**
 * The first and last page that touch the window `[top, top + viewH)`. When the
 * window sits wholly in a gap, both are the page just below it. Null for an
 * empty stack.
 */
export function visibleRange(offsets: readonly number[], heights: readonly number[], top: number, viewH: number): { first: number; last: number } | null {
	const n = offsets.length;
	if (n === 0) return null;
	const bottom = top + viewH;
	// First page whose bottom edge is below the window's top.
	let lo = 0;
	let hi = n - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (offsets[mid] + heights[mid] > top) hi = mid;
		else lo = mid + 1;
	}
	const first = lo;
	let last = first;
	while (last + 1 < n && offsets[last + 1] < bottom) last++;
	return { first, last };
}

/**
 * The page occupying most of the window; the earlier one on a tie. Index, from
 * 0. Null for an empty stack.
 */
export function mostVisiblePage(offsets: readonly number[], heights: readonly number[], top: number, viewH: number): number | null {
	const range = visibleRange(offsets, heights, top, viewH);
	if (!range) return null;
	let best = range.first;
	let bestShown = -1;
	for (let i = range.first; i <= range.last; i++) {
		const shown = Math.min(top + viewH, offsets[i] + heights[i]) - Math.max(top, offsets[i]);
		if (shown > bestShown) {
			best = i;
			bestShown = shown;
		}
	}
	return best;
}

/** The pages to keep drawn: the visible ones and `margin` more either side, within `n` pages. */
export function renderWindow(first: number, last: number, n: number, margin: number): { from: number; to: number } {
	return { from: Math.max(0, first - margin), to: Math.min(n - 1, last + margin) };
}

/** A point in the stack, held as a page and how far down it (0 top, 1 bottom; outside 0-1 is the gap or padding). */
export interface Anchor {
	index: number;
	frac: number;
}

/** The anchor for the point `y` down the content. */
export function anchorAt(offsets: readonly number[], heights: readonly number[], y: number): Anchor {
	if (offsets.length === 0) return { index: 0, frac: 0 };
	let lo = 0;
	let hi = offsets.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (offsets[mid] <= y) lo = mid;
		else hi = mid - 1;
	}
	return { index: lo, frac: heights[lo] > 0 ? (y - offsets[lo]) / heights[lo] : 0 };
}

/**
 * The scroll position that puts `anchor` `viewY` pixels below the top of the
 * window, in a layout that may since have been rescaled. Never negative.
 */
export function scrollForAnchor(offsets: readonly number[], heights: readonly number[], anchor: Anchor, viewY: number): number {
	const i = clamp(anchor.index, 0, offsets.length - 1);
	if (i < 0) return 0;
	return Math.max(0, offsets[i] + anchor.frac * heights[i] - viewY);
}

/**
 * The horizontal scroll that keeps the same spot under `viewX` when content
 * centred in a width `oldWidth` grows by `ratio` to `newWidth`. Pages sit in
 * the middle of the content, so distance from the middle scales with them.
 */
export function scrollLeftForZoom(scrollLeft: number, viewX: number, oldWidth: number, newWidth: number, ratio: number): number {
	const fromMiddle = scrollLeft + viewX - oldWidth / 2;
	return Math.max(0, newWidth / 2 + fromMiddle * ratio - viewX);
}

/**
 * How far to move the scroll when a page the reader has measured changes
 * height by `delta`: all of it if the page lies wholly above the window (so
 * what is on screen does not slide), none otherwise.
 */
export function scrollShift(pageTop: number, oldHeight: number, scrollTop: number, delta: number): number {
	return pageTop + oldHeight <= scrollTop ? delta : 0;
}

/**
 * The pixel ratio to draw a canvas at: the device's, capped at `cap` for
 * speed, and lowered further so `cssW * cssH * ratio^2` stays within
 * `maxPixels`, which bounds a phone's memory when zoomed in. Never below 0.25.
 */
export function canvasRatio(cssW: number, cssH: number, deviceRatio: number, cap: number, maxPixels: number): number {
	let ratio = Math.min(deviceRatio > 0 ? deviceRatio : 1, cap);
	const area = cssW * cssH;
	if (area > 0 && area * ratio * ratio > maxPixels) ratio = Math.sqrt(maxPixels / area);
	return Math.max(0.25, ratio);
}
