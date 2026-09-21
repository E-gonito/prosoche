/**
 * Dragging tasks between the lists and the timeline.
 *
 * Two gestures share one registry of drop zones:
 *
 *  - Picking a task up from a list and dropping it on the timeline, which
 *    gives it a time. The whole gesture lives here.
 *  - Dragging a block already on the timeline out onto a list, which clears
 *    its time. The timeline owns that gesture, because it also has to
 *    reposition the block continuously, and only asks this module which zone
 *    the pointer is over.
 *
 * Pointer events rather than HTML drag-and-drop, so the same code works with
 * a finger.
 */

import type { Task } from '$lib/shared/task';
import { area, passedThreshold, pointInRect } from '$lib/shared/geometry';

export interface DropZone {
	id: string;
	element: HTMLElement;
	/** Minute of the day at a screen position. Omitted by zones without time. */
	minuteAt?: (clientY: number) => number;
	/** Called on release inside the zone. `minute` is null for timeless zones. */
	drop: (task: Task, minute: number | null) => void;
}

/** Live drag state, read by the dragged row and by the zone under the pointer. */
export const drag = $state<{
	task: Task | null;
	x: number;
	y: number;
	/** Id of the zone under the pointer, or null. */
	zone: string | null;
	/** Minute under the pointer when that zone has a time axis. */
	over: number | null;
}>({ task: null, x: 0, y: 0, zone: null, over: null });

const zones = new Map<string, DropZone>();

/** Register a zone. Returns the function that removes it again. */
export function registerDropZone(zone: DropZone): () => void {
	zones.set(zone.id, zone);
	return () => {
		if (zones.get(zone.id) === zone) zones.delete(zone.id);
	};
}

/**
 * The zone under a screen position, if any. Smaller zones win, so a list
 * overlapping a large timeline still receives the drop.
 */
export function zoneAt(x: number, y: number): DropZone | null {
	let best: DropZone | null = null;
	let bestArea = Infinity;
	for (const zone of zones.values()) {
		const rect = zone.element.getBoundingClientRect();
		if (!pointInRect(x, y, rect)) continue;
		const size = area(rect);
		if (size < bestArea) {
			best = zone;
			bestArea = size;
		}
	}
	return best;
}

/**
 * Begin dragging `task` out of a list. The drag only becomes active once the
 * pointer has moved a few pixels, so a tap on the grip is not a drag.
 */
export function startDrag(task: Task, event: PointerEvent): void {
	if (event.button !== 0) return;
	event.preventDefault();

	const fromX = event.clientX;
	const fromY = event.clientY;
	let active = false;

	const move = (e: PointerEvent) => {
		if (!active && !passedThreshold(fromX, fromY, e.clientX, e.clientY)) return;
		if (!active) {
			active = true;
			drag.task = task;
		}
		drag.x = e.clientX;
		drag.y = e.clientY;
		const zone = zoneAt(e.clientX, e.clientY);
		drag.zone = zone?.id ?? null;
		drag.over = zone?.minuteAt ? zone.minuteAt(e.clientY) : null;
	};

	const up = (e: PointerEvent) => {
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', up);
		window.removeEventListener('pointercancel', up);

		const dragged = drag.task;
		const minute = drag.over;
		const zone = active ? zoneAt(e.clientX, e.clientY) : null;
		drag.task = null;
		drag.zone = null;
		drag.over = null;

		// A task already in the zone it was dropped on has nothing to change.
		if (dragged && zone) zone.drop(dragged, zone.minuteAt ? minute : null);
	};

	window.addEventListener('pointermove', move);
	window.addEventListener('pointerup', up);
	window.addEventListener('pointercancel', up);
}
