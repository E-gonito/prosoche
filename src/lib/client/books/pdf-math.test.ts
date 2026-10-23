import { describe, expect, test } from 'vitest';
import { anchorAt, canvasRatio, clamp, layoutPages, mostVisiblePage, renderWindow, scrollForAnchor, scrollLeftForZoom, scrollShift, visibleRange } from './pdf-math';

// Ten pages of 100 px, 10 apart, 10 of padding: tops at 10, 120, 230, ...
const heights = Array.from({ length: 10 }, () => 100);
const offsets = layoutPages(heights, 10, 10);

describe('layoutPages', () => {
	test.each([
		[[], []],
		[[100], [10]],
		[[100, 50, 200], [10, 120, 180]]
	])('%j', (h, tops) => {
		expect(layoutPages(h, 10, 10)).toEqual(tops);
	});
});

describe('visibleRange', () => {
	test.each([
		[0, 100, 0, 0],
		[0, 150, 0, 1],
		[115, 10, 1, 1], // wholly in the gap after page 0: the page just below it
		[110, 20, 1, 1],
		[300, 200, 2, 4],
		[5000, 100, 9, 9]
	])('top %i height %i', (top, h, first, last) => {
		const r = visibleRange(offsets, heights, top, h);
		expect(r?.first).toBe(first);
		expect(r?.last).toBe(last);
	});
	test('empty stack', () => expect(visibleRange([], [], 0, 100)).toBeNull());
});

describe('mostVisiblePage', () => {
	test.each([
		[0, 200, 0], // page 0 shows 90 (10..100), page 1 shows 80 (120..200)... 0 wins
		[60, 200, 1], // page 0 shows 40, page 1 shows 100, page 2 starts at 230 > 260? shows 30
		[100, 300, 1], // page 1: 100, page 2: 100, page 3 partly; tie goes to the earlier
		[5000, 100, 9]
	])('top %i height %i is page %i', (top, h, want) => {
		expect(mostVisiblePage(offsets, heights, top, h)).toBe(want);
	});
	test('a page taller than the window', () => {
		const tall = [1000, 1000];
		expect(mostVisiblePage(layoutPages(tall, 10, 10), tall, 1100, 400)).toBe(1);
	});
	test('empty stack', () => expect(mostVisiblePage([], [], 0, 100)).toBeNull());
});

describe('renderWindow', () => {
	test.each([
		[4, 5, 10, 2, 2, 7],
		[0, 0, 10, 2, 0, 2],
		[9, 9, 10, 2, 7, 9],
		[0, 0, 1, 2, 0, 0]
	])('visible %i-%i of %i, margin %i', (first, last, n, margin, from, to) => {
		expect(renderWindow(first, last, n, margin)).toEqual({ from, to });
	});
});

describe('anchors keep the spot when the scale changes', () => {
	test('round trip at the same scale', () => {
		const a = anchorAt(offsets, heights, 275);
		expect(a.index).toBe(2);
		expect(a.frac).toBeCloseTo(0.45);
		expect(scrollForAnchor(offsets, heights, a, 50)).toBeCloseTo(225);
	});
	test('doubling the scale', () => {
		// The point 275 px down, 50 px below the window's top (scroll 225).
		const a = anchorAt(offsets, heights, 275);
		const h2 = heights.map((h) => h * 2);
		const o2 = layoutPages(h2, 10, 10);
		const scroll = scrollForAnchor(o2, h2, a, 50);
		// Same page, same fraction down it, still 50 px under the top.
		expect(o2[2] + 0.45 * h2[2] - scroll).toBeCloseTo(50);
	});
	test('a point above the first page', () => {
		expect(anchorAt(offsets, heights, 0)).toEqual({ index: 0, frac: -0.1 });
	});
	test('never scrolls above the top', () => {
		expect(scrollForAnchor(offsets, heights, { index: 0, frac: 0 }, 500)).toBe(0);
	});
	test('empty stack', () => {
		expect(anchorAt([], [], 10)).toEqual({ index: 0, frac: 0 });
		expect(scrollForAnchor([], [], { index: 0, frac: 0 }, 0)).toBe(0);
	});
});

describe('scrollLeftForZoom', () => {
	test.each([
		// Fits the window, then zooms: content grows from 400 to 800, doubled; nothing scrolled, point at the middle stays there.
		[0, 200, 400, 800, 2, 200],
		// Scrolled 100 in 800 wide, zoom out to 400 wide: the spot 300 left of the middle is now 150 left of it.
		[100, 0, 800, 400, 0.5, 50],
		// Pointing 100 right of the middle: it ends 200 right of the middle, so the scroll moves to keep it under the finger.
		[0, 300, 400, 800, 2, 300]
	])('left %i at x %i, %i to %i wide', (left, x, oldW, newW, ratio, want) => {
		expect(scrollLeftForZoom(left, x, oldW, newW, ratio)).toBeCloseTo(want);
	});
});

describe('scrollShift', () => {
	test.each([
		[0, 100, 500, 30, 30], // wholly above: follow the change
		[400, 100, 500, 30, 30], // bottom edge exactly at the top of the window
		[450, 100, 500, 30, 0], // straddles the top
		[600, 100, 500, 30, 0] // below
	])('page at %i, height %i, scrolled %i, delta %i', (top, h, scroll, delta, want) => {
		expect(scrollShift(top, h, scroll, delta)).toBe(want);
	});
});

describe('canvasRatio', () => {
	test.each([
		[400, 600, 3, 2, 8e6, 2], // device 3, capped at 2
		[400, 600, 1.5, 2, 8e6, 1.5],
		[400, 600, 0, 2, 8e6, 1], // nonsense device ratio
		[2000, 3000, 2, 2, 8e6, Math.sqrt(8e6 / 6e6)], // zoomed in: lowered to the budget
		[1e5, 1e5, 2, 2, 8e6, 0.25] // floor
	])('%i x %i css at device %f', (w, h, dpr, cap, max, want) => {
		expect(canvasRatio(w, h, dpr, cap, max)).toBeCloseTo(want);
	});
});

test('clamp', () => {
	expect([clamp(5, 0, 3), clamp(-1, 0, 3), clamp(2, 0, 3)]).toEqual([3, 0, 2]);
});
