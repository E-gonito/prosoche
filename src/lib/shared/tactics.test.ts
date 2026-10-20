import { describe, expect, it } from 'vitest';
import { judge, missionGrade, optionIndexForKey, tagAccuracy, TACTICS } from './tactics';

const choice = { answers: [['B']], roeViolation: ['A'], timeLimitS: 4 };
const order = { answers: [['A1', 'A2', 'A3']], roeViolation: [], timeLimitS: 8 };

describe('judge', () => {
	it.each([
		['right in time', choice, ['B'], 3999, 'in-time', 100, false],
		['right on the limit', choice, ['B'], 4000, 'in-time', 100, false],
		['right but late', choice, ['B'], 4001, 'late', 60, false],
		['right at the overtime edge', choice, ['B'], 8000, 'late', 60, false],
		['right after overtime', choice, ['B'], 8001, 'timeout', 0, false],
		['wrong', choice, ['C'], 1000, 'wrong', 0, false],
		['an ROE violation', choice, ['A'], 1000, 'wrong', 0, true],
		['an ROE violation, late', choice, ['A'], 6000, 'wrong', 0, true],
		['no answer', choice, null, 9000, 'timeout', 0, false],
		['a clear order in order', order, ['A1', 'A2', 'A3'], 5000, 'in-time', 100, false],
		['a clear order out of order', order, ['A2', 'A1', 'A3'], 5000, 'wrong', 0, false],
		['a clear order cut short', order, ['A1', 'A2'], 5000, 'wrong', 0, false]
	] as const)('scores %s', (_name, scenario, answer, ms, result, points, roe) => {
		expect(judge(scenario, answer ? [...answer] : null, ms)).toEqual({ result, points, roe, correct: result === 'in-time' || result === 'late' });
	});

	it('scores a slow right answer above a fast wrong one', () => {
		expect(judge(choice, ['B'], 7000).points).toBeGreaterThan(judge(choice, ['C'], 500).points);
	});
});

describe('missionGrade', () => {
	const drills = (points: number[], roe = false) => points.map((p, i) => ({ points: p, roe: roe && i === 0 }));
	it.each([
		[[100, 100, 100], 'S'],
		[[100, 100, 60], 'A'],
		[[100, 60, 60], 'B'],
		[[100, 60, 60, 0], 'C'],
		[[60, 0, 0], 'D'],
		[[], 'D']
	] as const)('grades %j as %s', (points, grade) => {
		expect(missionGrade(drills([...points])).grade).toBe(grade);
	});

	it('caps any ROE violation at D, whatever the points', () => {
		const graded = missionGrade([{ points: 0, roe: true }, ...Array(9).fill({ points: 100, roe: false })]);
		expect(graded).toMatchObject({ grade: 'D', mean: 90, violations: 1 });
	});
});

describe('tagAccuracy', () => {
	const scenarios = new Map([
		['a', { tags: ['cqb.pie', 'cqb.corner'] }],
		['b', { tags: ['cqb.pie'] }]
	]);

	it('moves each tag by alpha toward the answer', () => {
		const stats = tagAccuracy([{ scenario: 'a', correct: true }], scenarios);
		const expected = TACTICS.alpha + (1 - TACTICS.alpha) * TACTICS.prior;
		expect(stats['cqb.pie'].accuracy).toBeCloseTo(expected);
		expect(stats['cqb.corner']).toEqual({ accuracy: stats['cqb.pie'].accuracy, answers: 1 });
	});

	it('continues from an earlier state without changing it', () => {
		const before = tagAccuracy([{ scenario: 'b', correct: false }], scenarios);
		const after = tagAccuracy([{ scenario: 'b', correct: false }], scenarios, before);
		expect(after['cqb.pie'].accuracy).toBeLessThan(before['cqb.pie'].accuracy);
		expect(before['cqb.pie'].answers).toBe(1);
	});

	it('skips an attempt at a scenario it does not know', () => {
		expect(tagAccuracy([{ scenario: 'gone', correct: true }], scenarios)).toEqual({});
	});
});

describe('optionIndexForKey', () => {
	it.each([
		['1', true, 0],
		['4', false, 3],
		['b', true, 1],
		['B', true, 1],
		['b', false, null],
		['0', true, null],
		['z', true, null]
	] as const)('%s (letters %s) picks %s', (key, letters, index) => {
		expect(optionIndexForKey(key, letters)).toBe(index);
	});
});
