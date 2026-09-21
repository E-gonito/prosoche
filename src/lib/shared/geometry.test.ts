import { describe, it, expect } from 'vitest';
import { pointInRect, area, passedThreshold } from './geometry';

const rect = (left: number, top: number, width: number, height: number) => ({
	left,
	top,
	right: left + width,
	bottom: top + height
});

describe('pointInRect', () => {
	it('accepts a point inside', () => {
		expect(pointInRect(50, 50, rect(0, 0, 100, 100))).toBe(true);
	});

	it('accepts the edges, so a drop on the boundary is not lost', () => {
		expect(pointInRect(0, 0, rect(0, 0, 100, 100))).toBe(true);
		expect(pointInRect(100, 100, rect(0, 0, 100, 100))).toBe(true);
	});

	it('rejects a point outside on any side', () => {
		const r = rect(10, 10, 80, 80);
		expect(pointInRect(5, 50, r)).toBe(false);
		expect(pointInRect(95, 50, r)).toBe(false);
		expect(pointInRect(50, 5, r)).toBe(false);
		expect(pointInRect(50, 95, r)).toBe(false);
	});
});

describe('area', () => {
	it('prefers the smaller of two overlapping zones', () => {
		expect(area(rect(0, 0, 400, 900))).toBeGreaterThan(area(rect(0, 0, 300, 200)));
	});
	it('is never negative for an inverted rectangle', () => {
		expect(area({ left: 10, top: 10, right: 0, bottom: 0 })).toBe(0);
	});
});

describe('passedThreshold', () => {
	it('ignores a tap', () => {
		expect(passedThreshold(100, 100, 101, 101)).toBe(false);
	});
	it('accepts a real movement in any direction', () => {
		expect(passedThreshold(100, 100, 100, 95)).toBe(true);
		expect(passedThreshold(100, 100, 96, 100)).toBe(true);
	});
});
