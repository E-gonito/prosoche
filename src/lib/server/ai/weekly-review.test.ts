import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoteIndex } from '../index/index';
import { Vault } from '../vault/index';
import { gather, propose, render, reviewPath, weekLabel, type WeekFacts } from './weekly-review';
import { weekOf } from '../timelog';
import type { RunStamp } from '$lib/shared/ai';

const DAY = '2026-09-23';
const WEEK = weekOf(DAY);

const STAMP: RunStamp = {
	model: 'claude-opus-5',
	effort: 'high',
	permission: 'read-only',
	budgetUsd: 1,
	timeoutSeconds: 300,
	feature: 'weekly-review',
	startedAt: `${DAY}T18:00:00.000Z`,
	durationMs: 4000,
	costUsd: 0.4
};

describe('weekLabel', () => {
	it('numbers an ordinary week', () => {
		expect(weekLabel(weekOf('2026-09-23'))).toBe('2026-W39');
	});

	it('keeps the last days of December in the next year when ISO says so', () => {
		// 2025-12-29 is a Monday; its Thursday is 2026-01-01, so it is 2026-W01.
		expect(weekLabel(weekOf('2025-12-31'))).toBe('2026-W01');
	});

	it('gives the same label for every day of one week', () => {
		const labels = weekOf('2026-09-23').map((d) => weekLabel(weekOf(d)));
		expect(new Set(labels).size).toBe(1);
	});
});

describe('reviewPath', () => {
	it('stays inside the folder the path policy allows', () => {
		expect(reviewPath(WEEK)).toBe('Journal/Weekly/2026-W39.md');
	});
});

describe('render', () => {
	const bare: WeekFacts = {
		week: WEEK,
		summary: {
			days: WEEK.map((day) => ({ day, plannedMinutes: 0, doneMinutes: 0, loggedMinutes: 0 })),
			plannedMinutes: 0,
			doneMinutes: 0,
			loggedMinutes: 0,
			byWorkspace: [],
			byQuadrant: [],
			unmatched: [],
			scoped: false
		},
		finished: [],
		carrying: []
	};

	it('says a quiet week was quiet rather than showing empty headings', () => {
		const out = render(bare);
		expect(out).toContain('Nothing planned and nothing logged this week.');
		expect(out).not.toContain('## Finished');
		expect(out).not.toContain('## Still open');
	});

	it('puts the commentary above the figures and never invents one', () => {
		expect(render(bare)).not.toContain('undefined');
		const out = render(bare, 'A slow week.');
		expect(out.indexOf('A slow week.')).toBeLessThan(out.indexOf('## Time'));
	});

	it('reports the hours it was given', () => {
		const out = render({
			...bare,
			summary: {
				...bare.summary,
				plannedMinutes: 300,
				loggedMinutes: 245,
				byWorkspace: [{ slug: 'atlas', name: 'Atlas', color: '#000', minutes: 245, timedMinutes: 245 }],
				byQuadrant: [{ quadrant: 1, minutes: 245 }]
			}
		});
		expect(out).toContain('- 0m done and 4h5m timed against 5h planned.');
		expect(out).toContain('- Atlas: 4h5m');
		expect(out).toContain('- Q1: 4h5m');
	});

	// The author's own week: everything ticked, the timer never started. The
	// per-workspace lines are the combined figure, so they still add up.
	it('reports a week that was ticked rather than timed', () => {
		const out = render({
			...bare,
			summary: {
				...bare.summary,
				plannedMinutes: 480,
				doneMinutes: 450,
				loggedMinutes: 0,
				byWorkspace: [{ slug: 'kaya', name: 'Kaya', color: '#000', minutes: 450, timedMinutes: 0 }],
				byQuadrant: [{ quadrant: 1, minutes: 450 }]
			}
		});
		expect(out).toContain('- 7h30m done and 0m timed against 8h planned.');
		expect(out).toContain('- Kaya: 7h30m');
		expect(out).not.toContain('Nothing planned');
	});

	it('ends with exactly one newline, like every note this app writes', () => {
		expect(render(bare).endsWith('\n')).toBe(true);
		expect(render(bare).endsWith('\n\n')).toBe(false);
	});
});

describe('propose', () => {
	it('is one create, pre-accepted by nobody', () => {
		const facts: WeekFacts = {
			week: WEEK,
			summary: {
				days: [],
				plannedMinutes: 0,
				doneMinutes: 0,
				loggedMinutes: 0,
				byWorkspace: [],
				byQuadrant: [],
				unmatched: [],
				scoped: false
			},
			finished: [],
			carrying: []
		};
		const proposal = propose(facts, '', STAMP);
		expect(proposal.edits).toHaveLength(1);
		expect(proposal.edits[0].kind).toBe('create');
		expect(proposal.edits[0].path).toBe('Journal/Weekly/2026-W39.md');
		expect(proposal.accepted).toEqual([]);
	});
});

describe('gather', () => {
	let dir: string;
	let vault: Vault;
	let index: NoteIndex;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'weekly-'));
		vault = new Vault(dir);
		index = new NoteIndex(':memory:');
	});

	afterEach(async () => {
		index.close();
		await rm(dir, { recursive: true, force: true });
	});

	it('counts what the week did and did not finish', async () => {
		const note = ['# Day planner', '- [x] 09:00 - 10:00 Ship the parser `Q1`', '- [ ] Write it up `Q2`', ''].join('\n');
		await vault.write('Journal/2026/09/23.md', note);
		index.put('Journal/2026/09/23.md', note, Date.now(), 'h');

		const facts = await gather(vault, index, DAY);
		expect(facts.finished.map((t) => t.text)).toEqual(['Ship the parser']);
		expect(facts.week).toHaveLength(7);
	});

	it('leaves the daily notes out of the still-open list', async () => {
		const daily = '- [ ] From the template `Q1`\n';
		const other = '- [ ] Real backlog item `Q1`\n';
		await vault.write('Journal/2026/09/22.md', daily);
		index.put('Journal/2026/09/22.md', daily, Date.now(), 'a');
		await vault.write('Work/Backlog.md', other);
		index.put('Work/Backlog.md', other, Date.now(), 'b');

		const facts = await gather(vault, index, DAY);
		expect(facts.carrying.map((t) => t.path)).toEqual(['Work/Backlog.md']);
	});
});
