import { describe, expect, it } from 'vitest';
import { analyse } from './insights';

const node = (id: string, community: number, file = 'A/x.md') => ({ id, label: id, community, community_name: `C${community}`, file_type: 'concept', source_file: file });
const link = (source: string, target: string, confidence = 'EXTRACTED', score = 1) => ({ source, target, relation: 'references', confidence, confidence_score: score });

describe('analyse', () => {
	it('reads a malformed file as an empty graph', () => {
		expect(analyse(null).nodes).toBe(0);
		expect(analyse({ nodes: 'x' }).tips).toEqual([]);
	});

	it('drops links that name a missing node', () => {
		expect(analyse({ nodes: [node('a', 0)], links: [link('a', 'ghost')] }).edges).toBe(0);
	});

	const g = analyse({
		nodes: [node('hub', 0), node('a', 0), node('b', 1, 'B/y.md'), node('c', 2, 'B/z.md'), node('lone', 3, 'C/q.md')],
		links: [link('hub', 'a'), link('hub', 'b', 'INFERRED', 0.9), link('hub', 'c', 'AMBIGUOUS', 0.5), link('b', 'c')]
	});

	it('ranks hubs by degree', () => {
		expect(g.godNodes[0]).toMatchObject({ label: 'hub', degree: 3 });
	});

	it('finds the node that joins the most other communities as a bridge', () => {
		expect(g.bridges[0]).toMatchObject({ label: 'hub', reaches: 2 });
	});

	it('counts edges by confidence and lists inferred cross-community ones', () => {
		expect(g.confidence).toEqual({ extracted: 2, inferred: 1, ambiguous: 1 });
		expect(g.surprises).toHaveLength(1);
		expect(g.ambiguous).toHaveLength(1);
	});

	it('flags a one-node community as an island and a linkless node as a loose end', () => {
		expect(g.islands.map((c) => c.name)).toContain('C3');
		expect(g.looseEnds).toBeGreaterThanOrEqual(1);
	});

	it('measures how much of a folder links out of it', () => {
		expect(g.folders.find((f) => f.folder === 'C')!.reach).toBe(0);
		expect(g.folders.find((f) => f.folder === 'A')!.reach).toBeGreaterThan(0);
	});
});
