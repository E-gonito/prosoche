/**
 * Dragging a card across a board, with a mouse or a finger.
 *
 * A sibling of `drag.svelte.ts` rather than a use of it: that module moves a
 * `Task` between registered zones and asks each zone for a minute, where a
 * board needs a column and a place among its cards, read off the cards on
 * screen. What the two share, the threshold that tells a tap from a drag, is
 * `shared/geometry`.
 *
 * The board marks itself up and this module reads the marks, so it needs no
 * registration: `[data-board-scroll]` is the element that scrolls sideways,
 * `[data-column="<i>"]` each column, and `[data-card="<line>"]` each card in
 * it. Pointer events throughout, so one code path serves both inputs; a
 * finger starts a drag only from a card's `[data-grip]`, because anywhere
 * else it is scrolling the page, and a mouse from anywhere on the card but a
 * control marked `[data-nodrag]` (its checkbox, its menu) or a field.
 */

import { passedThreshold } from '$lib/shared/geometry';

/** Where a dropped card would land: a column, and its place among that column's cards. */
export interface BoardDrop {
	column: number;
	/** Position in the target column once the card is there, the dragged card not counted. */
	index: number;
}

/** Live drag state, read by the board to draw the ghost and the drop line. */
export const boardDrag = $state<{
	/** Line of the card being dragged, or null when nothing is. */
	line: number | null;
	title: string;
	x: number;
	y: number;
	target: BoardDrop | null;
}>({ line: null, title: '', x: 0, y: 0, target: null });

/** Set for one click after a drag ends, so the drop is not also read as "open the card". */
let swallowClick = false;

/**
 * Whether the click that is happening now ended a drag, and should do
 * nothing. Resets itself: it answers true at most once per drag.
 */
export function clickEndedDrag(): boolean {
	const was = swallowClick;
	swallowClick = false;
	return was;
}

/** How close to the scroller's edge, in pixels, the pointer has to be before it scrolls. */
const EDGE = 48;

/**
 * Begin a possible drag of the card at `line` from a pointerdown on it.
 *
 * Nothing happens until the pointer has moved past the tap threshold, so a
 * click still opens the card. While dragging, `boardDrag.target` follows the
 * pointer, and the board scrolls sideways when the pointer rests near either
 * edge. On release over a column, `ondrop` is called with the target; it is
 * not called when the card is dropped where it started or outside the board.
 * Touches the DOM only to read positions and scroll; never writes a card.
 */
export function startBoardDrag(
	event: PointerEvent,
	card: { line: number; title: string; column: number; index: number },
	root: HTMLElement,
	ondrop: (target: BoardDrop) => void
): void {
	if (event.button !== 0) return;
	const fromGrip = (event.target as HTMLElement).closest('[data-grip]') !== null;
	if (event.pointerType !== 'mouse' && !fromGrip) return;
	if (!fromGrip && (event.target as HTMLElement).closest('[data-nodrag], input, textarea, select')) return;

	const fromX = event.clientX;
	const fromY = event.clientY;
	let active = false;
	const scroller = root.querySelector<HTMLElement>('[data-board-scroll]');

	const move = (e: PointerEvent) => {
		if (!active && !passedThreshold(fromX, fromY, e.clientX, e.clientY, 5)) return;
		if (!active) {
			active = true;
			boardDrag.line = card.line;
			boardDrag.title = card.title;
			document.body.classList.add('board-dragging');
		}
		e.preventDefault();
		boardDrag.x = e.clientX;
		boardDrag.y = e.clientY;
		boardDrag.target = targetAt(root, card.line, e.clientX, e.clientY);
	};

	let frame = requestAnimationFrame(function tick() {
		frame = requestAnimationFrame(tick);
		if (!active || !scroller) return;
		const rect = scroller.getBoundingClientRect();
		const step = boardDrag.x < rect.left + EDGE ? -14 : boardDrag.x > rect.right - EDGE ? 14 : 0;
		if (step && scroller.scrollWidth > scroller.clientWidth) {
			scroller.scrollLeft += step;
			boardDrag.target = targetAt(root, card.line, boardDrag.x, boardDrag.y);
		}
	});

	const up = () => {
		cancelAnimationFrame(frame);
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', up);
		window.removeEventListener('pointercancel', up);
		document.body.classList.remove('board-dragging');
		const target = boardDrag.target;
		boardDrag.line = null;
		boardDrag.target = null;
		if (!active) return;
		swallowClick = true;
		// A click never follows a touch drag, so the flag must not outlive it.
		setTimeout(() => (swallowClick = false), 0);
		if (target && !(target.column === card.column && target.index === card.index)) ondrop(target);
	};

	window.addEventListener('pointermove', move, { passive: false });
	window.addEventListener('pointerup', up);
	window.addEventListener('pointercancel', up);
}

/**
 * The column under `x`, and how many of its cards, the dragged one aside,
 * sit above `y`. Columns are matched on `x` alone so a long column's empty
 * foot is still a place to drop on. Null when the pointer is off the board.
 */
function targetAt(root: HTMLElement, dragged: number, x: number, y: number): BoardDrop | null {
	const board = root.getBoundingClientRect();
	if (y < board.top - EDGE || y > board.bottom + EDGE) return null;
	for (const column of root.querySelectorAll<HTMLElement>('[data-column]')) {
		const rect = column.getBoundingClientRect();
		if (x < rect.left || x > rect.right) continue;
		let index = 0;
		for (const el of column.querySelectorAll<HTMLElement>('[data-card]')) {
			if (Number(el.dataset.card) === dragged) continue;
			const r = el.getBoundingClientRect();
			if (y > r.top + r.height / 2) index++;
		}
		return { column: Number(column.dataset.column), index };
	}
	return null;
}
