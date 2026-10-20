import { describe, expect, it } from 'vitest';
import { planPrompt, planProposal } from './study-plan';
import { policyFor } from './proposal';
import { isGoalsPath } from '../study/subjects';
import { DEFAULT_BLAST } from './guardrails';
import type { RunStamp } from '$lib/shared/ai';

const stamp: RunStamp = {
	model: 'claude-sonnet-5-5',
	effort: 'medium',
	budgetUsd: 0.2,
	timeoutSeconds: 120,
	feature: 'study-plan',
	startedAt: '2026-10-20T12:00:00Z',
	durationMs: 1,
	costUsd: 0
};
const GOALS = '## Rails\n- [ ] Trace one endpoint 📅 2026-10-21\n\t- my note\n- [ ] Next 📅 2026-11-08\n';

describe('planProposal', () => {
	it('is one revise of Goals.md, pinned to the bytes read, adding only the details', () => {
		const proposal = planProposal('Study/CS/Goals.md', { content: GOALS, hash: 'abc' }, 1, { est: '45m', first: 'grep Gemfile', parts: ['A', 'B'] }, stamp)!;
		expect(proposal.feature).toBe('study-plan');
		expect(proposal.edits).toHaveLength(1);
		const edit = proposal.edits[0];
		expect(edit).toMatchObject({ kind: 'revise', path: 'Study/CS/Goals.md', expectedHash: 'abc' });
		expect((edit as { text: string }).text).toBe(
			'## Rails\n- [ ] Trace one endpoint 📅 2026-10-21\n\t- est:: 45m\n\t- first:: grep Gemfile\n\t- part:: A\n\t- part:: B\n\t- my note\n- [ ] Next 📅 2026-11-08\n'
		);
	});

	it('is null for a line that is not a step', () => {
		expect(planProposal('Study/CS/Goals.md', { content: GOALS, hash: 'abc' }, 0, { est: '1h', first: 'x', parts: [] }, stamp)).toBeNull();
	});
});

describe('planPrompt', () => {
	it('names the step and the repo, and asks for no answers', () => {
		const prompt = planPrompt({ subject: 'CS', goal: 'Rust', step: 'Exercise 1', due: '2026-10-25', others: ['Exercise 2'], repo: '~/dev/leyline-front', reading: [], sources: [] });
		expect(prompt).toContain('Step: Exercise 1 (due 2026-10-25)');
		expect(prompt).toContain('~/dev/leyline-front');
		expect(prompt).toContain('Never give the answer');
	});
});

describe('the study-plan write policy', () => {
	it.each([
		['Study/Computer Science/Goals.md', true],
		['Study/Goals.md', true],
		['Goals.md', false],
		['Study/CS/Notes.md', false],
		['Private/Goals.md', false],
		['Journal/2026/10/Goals.md', false],
		['_hub/Goals.md', false],
		['Study/../Private/Goals.md', false]
	])('%s is writable: %s', (path, ok) => {
		expect(isGoalsPath(path)).toBe(ok);
	});

	it('allows only the one Goals.md the draft names', () => {
		const policy = policyFor('study-plan', { enabled: true, blast: DEFAULT_BLAST }, { today: '2026-10-20', destinations: ['Study/CS/Goals.md', 'Study/X/Goals.md', 'Notes/a.md'] });
		expect(policy.path.allow).toEqual(['Study/CS/Goals.md']);
		expect(policy.blast.maxFiles).toBe(1);
	});
});
