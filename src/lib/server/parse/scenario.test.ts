import { describe, expect, it } from 'vitest';
import { checkMap, parseScenario } from './scenario';

const fm = (over: Record<string, string> = {}) => {
	const fields: Record<string, string> = {
		type: 'tactic-scenario',
		id: 'ron-0001',
		game: 'ron',
		drill: 'threat-call',
		tags: '[roe.compliance, roe.escalation]',
		difficulty: '2',
		time_limit_s: '4',
		provenance: 'own-aar',
		source: '""',
		verified_version: '""',
		status: 'draft',
		created: '2026-10-20',
		...over
	};
	return `---\n${Object.entries(fields)
		.filter(([, v]) => v !== 'OMIT')
		.map(([k, v]) => `${k}: ${v}`)
		.join('\n')}\n---\n`;
};

const CHOICE_BODY = `
## Situation
Suspect in the hallway, pistol held low.

## Options
- A: Lethal force
- B: Shout compliance command
- C: Pepperball
- D: Hold and wait

## Answer
B

## Why
Not aimed at anyone yet.

## Penalty
roe_violation: [A]
`;

const MAP = `
## Map
\`\`\`tactic-map
{ "grid": [10, 6],
  "walls": [[0,0,10,0],[0,6,10,6]],
  "doors": [{"id":"D1","at":[5,0]}],
  "angles": [{"id":"A1","from":[5,1],"dir":"N"},{"id":"A2","from":[5,1],"dir":"E"}],
  "entities": [{"type":"suspect","at":[8,3],"state":"weapon-low"},{"type":"player","at":[1,3]}] }
\`\`\`
`;

describe('parseScenario', () => {
	it('reads the brief’s example, the Penalty section included', () => {
		const read = parseScenario(fm() + MAP + CHOICE_BODY, 'Tactics/Scenarios/ron-0001.md');
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const s = read.scenario;
		expect(s).toMatchObject({
			id: 'ron-0001',
			game: 'ron',
			drill: 'threat-call',
			tags: ['roe.compliance', 'roe.escalation'],
			difficulty: 2,
			timeLimitS: 4,
			created: '2026-10-20',
			answers: [['B']],
			roeViolation: ['A'],
			why: 'Not aimed at anyone yet.',
			whySuggested: false
		});
		expect(s.options.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D']);
		expect(s.map?.v).toBe(1);
		expect(s.map?.entities[1]).toEqual({ type: 'player', at: [1, 3], state: '' });
	});

	it('reads roe_violation from the frontmatter too', () => {
		const read = parseScenario(fm({ roe_violation: '[A, C]' }) + CHOICE_BODY.replace(/## Penalty[\s\S]*$/, ''), 'x.md');
		expect(read.ok && read.scenario.roeViolation).toEqual(['A', 'C']);
	});

	it('reads a clear-order answer, with alternatives one per line', () => {
		const body = `${MAP}\n## Situation\nClear it.\n\n## Answer\nA1, A2\nA2 > A1\n`;
		const read = parseScenario(fm({ drill: 'clear-order' }) + body, 'x.md');
		expect(read.ok && read.scenario.answers).toEqual([
			['A1', 'A2'],
			['A2', 'A1']
		]);
	});

	it('marks a suggested Why, and will not approve it', () => {
		const suggested = CHOICE_BODY.replace('Not aimed at anyone yet.', '> [!suggestion]\n> Draft.');
		const draft = parseScenario(fm() + suggested, 'x.md');
		expect(draft.ok && draft.scenario.whySuggested).toBe(true);
		const approved = parseScenario(fm({ status: 'approved' }) + suggested, 'x.md');
		expect(approved.ok).toBe(false);
		if (!approved.ok) expect(approved.errors.join(' ')).toMatch(/suggestion/);
	});

	it('will not approve one with no Why', () => {
		const read = parseScenario(fm({ status: 'approved' }) + CHOICE_BODY.replace('Not aimed at anyone yet.', ''), 'x.md');
		expect(read.ok).toBe(false);
	});

	it.each([
		['invalid YAML', '---\nid: [unclosed\n---\n', /not valid YAML/],
		['a missing id', fm({ id: 'OMIT' }) + CHOICE_BODY, /`id:`/],
		['an unknown game', fm({ game: 'cs2' }) + CHOICE_BODY, /`game:` is "cs2"/],
		['a difficulty of 7', fm({ difficulty: '7' }) + CHOICE_BODY, /difficulty/],
		['no time limit', fm({ time_limit_s: 'OMIT' }) + CHOICE_BODY, /time_limit_s/],
		['a tag with a space', fm({ tags: '[cqb corner]' }) + CHOICE_BODY, /dot-namespaced/],
		['an answer that is not an option', fm() + CHOICE_BODY.replace(/## Answer\nB/, '## Answer\nE'), /"E" is not one of the options/],
		['an answer that is also an ROE violation', fm() + CHOICE_BODY.replace(/## Answer\nB/, '## Answer\nA'), /also listed as an ROE violation/],
		['no situation', fm() + CHOICE_BODY.replace('Suspect in the hallway, pistol held low.', ''), /Situation/],
		['a map with bad JSON', fm() + '## Map\n```tactic-map\n{ grid: }\n```\n' + CHOICE_BODY, /not valid JSON/],
		['a clear-order with no map', fm({ drill: 'clear-order' }) + '## Situation\nGo.\n## Answer\nA1\n', /needs a `## Map`/],
		['a clear-order naming an unknown angle', fm({ drill: 'clear-order' }) + MAP + '## Situation\nGo.\n## Answer\nA1, A9\n', /"A9"/]
	])('reports %s', (_name, content, problem) => {
		const read = parseScenario(content, 'x.md');
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.errors.join('\n')).toMatch(problem);
	});

	it('reports every problem at once', () => {
		const read = parseScenario(fm({ game: 'x', drill: 'y', difficulty: '0' }) + CHOICE_BODY, 'x.md');
		expect(!read.ok && read.errors.length).toBeGreaterThanOrEqual(3);
	});

	it('ignores a ## inside a fence', () => {
		const body = CHOICE_BODY.replace('## Why\n', '## Why\n```\n## Answer\nA\n```\n');
		const read = parseScenario(fm() + body, 'x.md');
		expect(read.ok && read.scenario.answers).toEqual([['B']]);
	});
});

describe('checkMap', () => {
	it.each([
		['not an object', [], /JSON object/],
		['a later version', { v: 2, grid: [4, 4] }, /version 2/],
		['no grid', {}, /"grid"/],
		['an entity off the grid', { grid: [4, 4], entities: [{ type: 'player', at: [9, 9] }] }, /off the grid/],
		['an unknown entity', { grid: [4, 4], entities: [{ type: 'dog', at: [1, 1] }] }, /"dog"/],
		['a bad direction', { grid: [4, 4], angles: [{ id: 'A1', from: [1, 1], dir: 'UP' }] }, /"UP"/],
		['a repeated id', { grid: [4, 4], doors: [{ id: 'X', at: [1, 1] }], angles: [{ id: 'X', from: [1, 1], dir: 'N' }] }, /used twice/],
		['a short wall', { grid: [4, 4], walls: [[0, 0, 4]] }, /wall/]
	])('refuses %s', (_name, raw, problem) => {
		const errors: string[] = [];
		expect(checkMap(raw, errors)).toBeNull();
		expect(errors.join('\n')).toMatch(problem);
	});
});
