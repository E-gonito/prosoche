/**
 * Small geometry helpers for pointer gestures.
 *
 * Kept free of runes so it can be unit tested without a Svelte toolchain, and
 * free of the DOM beyond the shape of a rectangle.
 */

export interface Rect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** True when the point is inside the rectangle, edges included. */
export function pointInRect(x: number, y: number, rect: Rect): boolean {
	return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** Area, used to prefer the smallest zone when two overlap. */
export function area(rect: Rect): number {
	return Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
}

/** Whether the drag has moved far enough to be a drag rather than a tap. */
export function passedThreshold(fromX: number, fromY: number, x: number, y: number, threshold = 4): boolean {
	return Math.hypot(x - fromX, y - fromY) >= threshold;
}
