/**
 * Arithmetic over a day's time blocks.
 *
 * Kept separate from the route because overlapping blocks are normal in this
 * vault: a long "work" block routinely contains shorter ones inside it. A
 * naive sum of durations would report more planned hours than the day has.
 */

export interface Block {
	startMin: number | null;
	endMin: number | null;
}

/** Duration of one block, treating an end before the start as crossing midnight. */
export function blockMinutes(block: Block): number {
	if (block.startMin === null || block.endMin === null) return 0;
	const span = block.endMin - block.startMin;
	return span < 0 ? span + 1440 : span;
}

/**
 * Minutes of the day covered by at least one block. Overlapping blocks are
 * counted once, so this answers "how much of my day is spoken for".
 */
export function coveredMinutes(blocks: Block[]): number {
	const ranges = blocks
		.filter((b): b is { startMin: number; endMin: number } => b.startMin !== null && b.endMin !== null)
		.map((b) => ({ from: b.startMin, to: b.startMin + blockMinutes(b) }))
		.sort((a, b) => a.from - b.from);

	let total = 0;
	let openFrom = -1;
	let openTo = -1;
	for (const range of ranges) {
		if (range.from > openTo) {
			if (openTo > openFrom) total += openTo - openFrom;
			openFrom = range.from;
			openTo = range.to;
		} else if (range.to > openTo) {
			openTo = range.to;
		}
	}
	if (openTo > openFrom) total += openTo - openFrom;
	return total;
}

/** Blocks that sit inside or across another block, which the timeline must stack. */
export function overlappingCount(blocks: Block[]): number {
	const ranges = blocks
		.filter((b): b is { startMin: number; endMin: number } => b.startMin !== null && b.endMin !== null)
		.map((b) => ({ from: b.startMin, to: b.startMin + blockMinutes(b) }))
		.sort((a, b) => a.from - b.from);

	let count = 0;
	for (let i = 0; i < ranges.length; i++) {
		for (let j = i + 1; j < ranges.length; j++) {
			if (ranges[j].from >= ranges[i].to) break;
			count++;
		}
	}
	return count;
}
