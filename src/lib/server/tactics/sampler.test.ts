import { describe, expect, it } from 'vitest';
import { openDifficulty, pickMission, schedules, seeded, weigh } from './sampler';
import { TACTICS, type Attempt, type Scenario } from '$lib/shared/tactics';

const scenario = (id: string, tags: string[], difficulty = 1): Scenario => ({
	id,
	path: `Tactics/Scenarios/${id}.md`,
	game: 'shared',
	drill: 'hold-peek',
	tags,
	difficulty,
	timeLimitS: 4,
	provenance: 'inferred',
	source: '',
	verifiedVersion: '',
	status: 'approved',
	created: '2026-10-20',
	situation: 'x',
	map: null,
	options: [
		{ key: 'A', text: 'a' },
		{ key: 'B', text: 'b' }
	],
	answers: [['B']],
	why: '',
	whySuggested: false,
	roeViolation: []
});

let minute = 0;
const attempt = (id: string, correct: boolean, day = '2026-10-19'): Attempt => {
	minute++;
	return {
		at: `${day}T10:${String(minute % 60).padStart(2, '0')}:00`,
		scenario: id,
		mission: 'm-test',
		answer: correct ? ['B'] : ['A'],
		result: correct ? 'in-time' : 'wrong',
		correct,
		ms: 1000,
		roe: false,
		device: 'pc'
	};
};

describe('pickMission', () => {
	const pool = [
		scenario('p1', ['cqb.pie']),
		scenario('p2', ['cqb.pie']),
		scenario('p3', ['cqb.pie']),
		scenario('p4', ['cqb.pie']),
		scenario('c1', ['cqb.corner']),
		scenario('c2', ['cqb.corner']),
		scenario('t1', ['cqb.tempo']),
		scenario('t2', ['cqb.tempo'])
	];

	it('is the same mission for the same seed', () => {
		const a = pickMission(pool, [], '2026-10-20', 8, seeded(42)).map((s) => s.id);
		const b = pickMission(pool, [], '2026-10-20', 8, seeded(42)).map((s) => s.id);
		expect(a).toEqual(b);
		expect(new Set(a).size).toBe(8);
	});

	it('never serves more than maxRun in a row on one primary tag while another is left', () => {
		for (let seed = 1; seed <= 50; seed++) {
			const ids = pickMission(pool, [], '2026-10-20', 8, seeded(seed)).map((s) => s.tags[0]);
			// Four pie scenarios among eight can always be spread out until the
			// others run out, so a run longer than two can only come at the end.
			const runs = ids.slice(0, 5).join(' ');
			expect(runs).not.toMatch(/(cqb\.pie) \1 \1/);
		}
	});

	it('serves fewer when the pool is smaller, and none from an empty one', () => {
		expect(pickMission(pool.slice(0, 3), [], '2026-10-20', 10, seeded(1))).toHaveLength(3);
		expect(pickMission([], [], '2026-10-20', 10, seeded(1))).toEqual([]);
	});

	it('draws the weak tag more often than the strong one', () => {
		const two = [scenario('weak', ['cqb.corner']), scenario('strong', ['cqb.pie'])];
		const history = [...Array(10)].flatMap(() => [attempt('weak', false), attempt('strong', true)]);
		let weakFirst = 0;
		for (let seed = 1; seed <= 200; seed++) if (pickMission(two, history, '2026-10-20', 1, seeded(seed))[0].id === 'weak') weakFirst++;
		expect(weakFirst).toBeGreaterThan(140);
	});
});

describe('weigh', () => {
	it('adds the novelty bonus only to a scenario never answered', () => {
		const [seen, fresh] = weigh([scenario('seen', ['a.b']), scenario('fresh', ['c.d'])], [attempt('seen', true, '2026-10-20')], '2026-10-20');
		expect(fresh.weight).toBeCloseTo(1 - TACTICS.prior + TACTICS.noveltyBonus);
		expect(seen.weight).toBeLessThan(fresh.weight);
	});

	it('adds the due bonus once the scheduler has it due', () => {
		const pool = [scenario('s', ['a.b'])];
		// A right answer puts it days out; a wrong one would be due again the same day.
		const history = [attempt('s', true, '2026-10-01')];
		expect(schedules(history).get('s')!.due <= '2026-10-20').toBe(true);
		const [due] = weigh(pool, history, '2026-10-20');
		const [notYet] = weigh(pool, history, '2026-10-01');
		expect(due.weight - notYet.weight).toBeCloseTo(TACTICS.dueBonus);
	});
});

describe('openDifficulty', () => {
	const pool = [scenario('e1', ['cqb.pie'], 1), scenario('h1', ['cqb.pie'], 2), scenario('x1', ['cqb.pie'], 3)];

	it('starts each tag at the easiest difficulty it has', () => {
		expect(openDifficulty([scenario('h', ['cqb.pie'], 2)], []).get('cqb.pie')).toBe(2);
		expect(openDifficulty(pool, []).get('cqb.pie')).toBe(1);
	});

	it('opens the next level after the last five at this one are 80% right', () => {
		const four = [...Array(4)].map(() => attempt('e1', true));
		expect(openDifficulty(pool, [attempt('e1', false), ...four]).get('cqb.pie')).toBe(2);
		expect(openDifficulty(pool, [attempt('e1', false), attempt('e1', false), ...four.slice(1)]).get('cqb.pie')).toBe(1);
		expect(openDifficulty(pool, four).get('cqb.pie')).toBe(1);
	});

	it('serves an unopened difficulty only once the open ones run out', () => {
		const mission = pickMission(pool, [], '2026-10-20', 3, seeded(7)).map((s) => s.id);
		expect(mission[0]).toBe('e1');
	});
});
