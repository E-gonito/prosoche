/**
 * Sizing rules for resizable panes.
 *
 * Pure, so the arithmetic that decides when a pane collapses can be tested
 * without a browser. The component layer only turns pointer positions into
 * numbers and hands them here.
 */

export interface PaneLimits {
	/** Narrowest the pane may be while still open. */
	min: number;
	/** Widest, so a side panel cannot swallow the editor. */
	max: number;
	/**
	 * Dragging narrower than this collapses the pane instead of fighting the
	 * minimum, which is how editors behave. Defaults to half the minimum.
	 */
	collapseBelow?: number;
}

/** Keep a width inside its limits. */
export function clampPane(width: number, limits: PaneLimits): number {
	if (!Number.isFinite(width)) return limits.min;
	return Math.round(Math.max(limits.min, Math.min(limits.max, width)));
}

/** True when a drag has gone far enough past the minimum to mean "collapse". */
export function shouldCollapse(width: number, limits: PaneLimits): boolean {
	const threshold = limits.collapseBelow ?? limits.min / 2;
	return width < threshold;
}

/**
 * Resolve a dragged width into the pane's next state.
 *
 * Returning both pieces together keeps the decision in one place: a drag can
 * either resize or collapse, never half of each.
 */
export function resolveDrag(width: number, limits: PaneLimits): { collapsed: boolean; width: number } {
	if (shouldCollapse(width, limits)) return { collapsed: true, width: limits.min };
	return { collapsed: false, width: clampPane(width, limits) };
}

/**
 * Widths the layout should actually render, after clamping to the space
 * available. On a narrow window the side panes give way before the editor
 * does, so the middle never disappears.
 */
export function fitPanes(
	total: number,
	panes: Array<{ width: number; collapsed: boolean; limits: PaneLimits }>,
	editorMin = 320
): number[] {
	const rendered = panes.map((p) => (p.collapsed ? 0 : clampPane(p.width, p.limits)));
	let over = rendered.reduce((sum, w) => sum + w, 0) + editorMin - total;
	if (over <= 0) return rendered;

	// Take from the widest pane first, until the editor has its minimum.
	for (let guard = 0; guard < 64 && over > 0; guard++) {
		let widest = -1;
		for (let i = 0; i < rendered.length; i++) {
			if (rendered[i] > 0 && (widest === -1 || rendered[i] > rendered[widest])) widest = i;
		}
		if (widest === -1) break;
		const floor = panes[widest].limits.min;
		const take = Math.min(over, rendered[widest] - floor);
		if (take <= 0) {
			rendered[widest] = 0;
			over -= floor;
			continue;
		}
		rendered[widest] -= take;
		over -= take;
	}
	return rendered;
}

const PREFIX = 'prosoche:pane';

export function paneKey(name: string, field: 'width' | 'collapsed'): string {
	return `${PREFIX}:${name}:${field}`;
}
