/**
 * Laying out time blocks that overlap.
 *
 * A day in this vault routinely has a long block with shorter ones inside it,
 * so the timeline cannot assume one block per row. Overlapping blocks are
 * grouped and placed in side-by-side columns, the way a calendar does it.
 *
 * Pure, so the arithmetic can be tested without a browser.
 */

export interface Positioned<T> {
	item: T;
	startMin: number;
	endMin: number;
	/** Zero-based column within this block's overlap group. */
	column: number;
	/** How many columns the group needs, for computing width. */
	columns: number;
}

/**
 * Place blocks into columns. `at` extracts the range; a block whose end is at
 * or before its start is treated as crossing midnight and clamped to the end
 * of the day, because a timeline shows one day.
 */
export function layoutBlocks<T>(items: T[], at: (item: T) => { startMin: number; endMin: number }): Positioned<T>[] {
	const blocks = items
		.map((item) => {
			const { startMin, endMin } = at(item);
			return { item, startMin, endMin: endMin > startMin ? endMin : 1440 };
		})
		.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

	const placed: Positioned<T>[] = [];
	let group: typeof placed = [];
	let groupEnd = -1;

	const closeGroup = () => {
		const columns = group.reduce((max, p) => Math.max(max, p.column + 1), 0);
		for (const p of group) p.columns = columns;
		group = [];
	};

	for (const block of blocks) {
		if (block.startMin >= groupEnd) {
			closeGroup();
			groupEnd = -1;
		}
		// First column whose last block has already finished.
		const columnEnds = new Map<number, number>();
		for (const p of group) columnEnds.set(p.column, Math.max(columnEnds.get(p.column) ?? 0, p.endMin));
		let column = 0;
		while ((columnEnds.get(column) ?? 0) > block.startMin) column++;

		const entry: Positioned<T> = { ...block, column, columns: 1 };
		group.push(entry);
		placed.push(entry);
		groupEnd = Math.max(groupEnd, block.endMin);
	}
	closeGroup();

	return placed;
}

/** The hour range a timeline should show: the vault's day start, widened to fit. */
export function timelineRange(blocks: Array<{ startMin: number; endMin: number }>, dayStartHour = 6): { fromMin: number; toMin: number } {
	let fromMin = dayStartHour * 60;
	let toMin = 22 * 60;
	for (const b of blocks) {
		fromMin = Math.min(fromMin, Math.floor(b.startMin / 60) * 60);
		const end = b.endMin > b.startMin ? b.endMin : 1440;
		toMin = Math.max(toMin, Math.ceil(end / 60) * 60);
	}
	return { fromMin: Math.max(0, fromMin), toMin: Math.min(1440, Math.max(toMin, fromMin + 120)) };
}

/** Round to the nearest step, matching the vault's Day Planner snap setting. */
export function snap(minutes: number, step = 10): number {
	return Math.round(minutes / step) * step;
}
