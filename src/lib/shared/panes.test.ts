import { describe, it, expect } from 'vitest';
import { clampPane, shouldCollapse, resolveDrag, fitPanes, paneKey } from './panes';

const limits = { min: 180, max: 480 };

describe('clampPane', () => {
	it('holds a width inside its limits', () => {
		expect(clampPane(300, limits)).toBe(300);
		expect(clampPane(50, limits)).toBe(180);
		expect(clampPane(900, limits)).toBe(480);
	});
	it('falls back to the minimum for a nonsense value', () => {
		expect(clampPane(NaN, limits)).toBe(180);
		expect(clampPane(Infinity, limits)).toBe(180);
	});
	it('returns whole pixels', () => {
		expect(clampPane(240.6, limits)).toBe(241);
	});
});

describe('shouldCollapse', () => {
	it('collapses only well past the minimum', () => {
		expect(shouldCollapse(179, limits)).toBe(false);
		expect(shouldCollapse(89, limits)).toBe(true);
	});
	it('honours an explicit threshold', () => {
		expect(shouldCollapse(140, { ...limits, collapseBelow: 150 })).toBe(true);
		expect(shouldCollapse(160, { ...limits, collapseBelow: 150 })).toBe(false);
	});
});

describe('resolveDrag', () => {
	it('resizes within range', () => {
		expect(resolveDrag(260, limits)).toEqual({ collapsed: false, width: 260 });
	});
	it('clamps rather than collapsing just below the minimum', () => {
		expect(resolveDrag(170, limits)).toEqual({ collapsed: false, width: 180 });
	});
	it('collapses when dragged far in, remembering a sane width for reopening', () => {
		expect(resolveDrag(20, limits)).toEqual({ collapsed: true, width: 180 });
	});
});

describe('fitPanes', () => {
	const two = [
		{ width: 240, collapsed: false, limits },
		{ width: 260, collapsed: false, limits }
	];

	it('leaves both panes alone when there is room', () => {
		expect(fitPanes(1400, two)).toEqual([240, 260]);
	});

	it('gives a collapsed pane no width', () => {
		expect(fitPanes(1400, [{ width: 240, collapsed: true, limits }, two[1]])).toEqual([0, 260]);
	});

	it('shrinks the widest pane first so the editor keeps its minimum', () => {
		const out = fitPanes(800, two);
		expect(out[0] + out[1]).toBeLessThanOrEqual(800 - 320);
		expect(out[1]).toBeLessThan(260);
	});

	it('drops a pane entirely rather than starve the editor', () => {
		const out = fitPanes(520, two);
		expect(out.filter((w) => w === 0).length).toBeGreaterThan(0);
		expect(out.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(200);
	});

	it('handles no panes at all', () => {
		expect(fitPanes(1000, [])).toEqual([]);
	});
});

describe('paneKey', () => {
	it('namespaces storage so two panes never collide', () => {
		expect(paneKey('notes-tree', 'width')).toBe('prosoche:pane:notes-tree:width');
		expect(paneKey('notes-tree', 'collapsed')).not.toBe(paneKey('notes-rail', 'collapsed'));
	});
});
