import { describe, it, expect } from 'vitest';
import { layoutBlocks, timelineRange, snap } from './layout';

const at = (b: { startMin: number; endMin: number }) => b;
const block = (startMin: number, endMin: number, name = '') => ({ startMin, endMin, name });

describe('layoutBlocks', () => {
	it('gives sequential blocks one column each', () => {
		const out = layoutBlocks([block(540, 600), block(600, 660)], at);
		expect(out.map((p) => [p.column, p.columns])).toEqual([
			[0, 1],
			[0, 1]
		]);
	});

	it('puts a nested block beside its container', () => {
		// The real shape: 10:40-18:00 work, with 14:00-14:30 reading inside it.
		const out = layoutBlocks([block(640, 1080, 'work'), block(840, 870, 'read')], at);
		const work = out.find((p) => p.item.name === 'work')!;
		const read = out.find((p) => p.item.name === 'read')!;
		expect(work.column).toBe(0);
		expect(read.column).toBe(1);
		expect(work.columns).toBe(2);
		expect(read.columns).toBe(2);
	});

	it('reuses a column once its block has finished', () => {
		const out = layoutBlocks([block(540, 720, 'long'), block(560, 580, 'a'), block(600, 620, 'b')], at);
		const a = out.find((p) => p.item.name === 'a')!;
		const b = out.find((p) => p.item.name === 'b')!;
		expect(a.column).toBe(1);
		expect(b.column).toBe(1);
		expect(a.columns).toBe(2);
	});

	it('starts a fresh group after a gap, so one busy hour does not narrow the whole day', () => {
		const out = layoutBlocks([block(540, 600, 'a'), block(550, 570, 'b'), block(700, 760, 'c')], at);
		expect(out.find((p) => p.item.name === 'c')!.columns).toBe(1);
		expect(out.find((p) => p.item.name === 'a')!.columns).toBe(2);
	});

	it('treats a backwards range as running to midnight', () => {
		const out = layoutBlocks([block(1410, 30)], at);
		expect(out[0].endMin).toBe(1440);
	});

	it('handles an empty day', () => {
		expect(layoutBlocks([], at)).toEqual([]);
	});
});

describe('timelineRange', () => {
	it('defaults to the vault day start', () => {
		expect(timelineRange([])).toEqual({ fromMin: 360, toMin: 1320 });
	});

	it('widens to fit an early block', () => {
		expect(timelineRange([block(310, 400)]).fromMin).toBe(300);
	});

	it('widens to fit a late block', () => {
		expect(timelineRange([block(1380, 1430)]).toMin).toBe(1440);
	});

	it('never returns an inverted or tiny range', () => {
		const r = timelineRange([block(1400, 1430)]);
		expect(r.toMin - r.fromMin).toBeGreaterThanOrEqual(120);
	});
});

describe('snap', () => {
	it('rounds to the ten minute grid the vault uses', () => {
		expect(snap(603)).toBe(600);
		expect(snap(606)).toBe(610);
		expect(snap(605)).toBe(610);
	});
	it('takes a different step when asked', () => {
		expect(snap(607, 15)).toBe(600);
	});
});
