import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoteIndex } from '../index/index';
import { Vault } from '../vault/index';
import { draft, draftPath, gather, render, type DraftFacts } from './timesheet-draft';
import { parseTimesheet } from '../timesheet';
import { TIME_LOG_HEADING } from '../timelog';

const DAY = '2026-09-21';
const DAY_PATH = 'Journal/2026/09/21.md';

const bare = (over: Partial<DraftFacts> = {}): DraftFacts => ({
	day: DAY,
	entries: [],
	finished: [],
	planned: [],
	firstMin: null,
	lastMin: null,
	loggedMinutes: 0,
	...over
});

describe('draftPath', () => {
	it('is a scratch note and never the timesheet', () => {
		expect(draftPath(DAY)).toBe('_hub/drafts/timesheet-2026-09-21.md');
		expect(draftPath(DAY)).not.toContain('TIMESHEET');
	});
});

describe('render', () => {
	it('uses the date format the real files use', () => {
		expect(render(bare(), { todo: [], done: [] })).toBe('# 21/09/2026\n');
	});

	it('never guesses a clock time', () => {
		const out = render(bare(), { todo: [], done: [] });
		expect(out).not.toContain('Start');
		expect(out).not.toContain('Leave');
	});

	it('takes the clock from the first and last logged entries', () => {
		const out = render(bare({ firstMin: 9 * 60 + 35, lastMin: 18 * 60 + 5 }), { todo: [], done: [] });
		expect(out).toContain('09:35 Start');
		expect(out).toContain('18:05 Leave');
	});

	it('numbers items the way the timesheet parser reads them', () => {
		const out = render(bare({ loggedMinutes: 0 }), {
			todo: ['Look at the user requirements branch'],
			done: ['Non-technical grading walkthrough', 'End-to-end tests']
		});
		const parsed = parseTimesheet(out);
		expect(parsed.days).toHaveLength(1);
		const headings = parsed.days[0].sections.map((s) => s.heading);
		expect(headings).toContain('Tasks to do');
		expect(headings).toContain("What's been done");
		const done = parsed.days[0].sections.find((s) => s.heading === "What's been done");
		expect(done?.items.map((i) => i.number)).toEqual([1, 2]);
		expect(done?.items.map((i) => i.text)).toEqual([
			'Non-technical grading walkthrough',
			'End-to-end tests'
		]);
	});

	it('leaves out a section with nothing in it', () => {
		const out = render(bare(), { todo: ['One thing'], done: [] });
		expect(out).toContain('## Tasks to do');
		expect(out).not.toContain("What's been done");
	});

	it('writes blockers only when there are some', () => {
		expect(render(bare(), { todo: [], done: [], blockers: '  ' })).not.toContain('BLOCKERS');
		expect(render(bare(), { todo: [], done: [], blockers: 'QMS documents' })).toContain('**BLOCKERS:** QMS documents');
	});
});

describe('gather and draft', () => {
	let dir: string;
	let vault: Vault;
	let index: NoteIndex;

	const NOTE = [
		'# Day planner',
		'- [x] 09:00 - 10:30 Grading walkthrough `Q1`',
		'- [ ] 11:00 - 12:00 Write the requirements up `Q2`',
		'',
		TIME_LOG_HEADING,
		'- 09:35 - 10:40 Grading walkthrough (1h5m) `Q1`',
		'- 11:00 - 12:15 Requirements (1h15m) `Q2`',
		''
	].join('\n');

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'ts-draft-'));
		vault = new Vault(dir);
		index = new NoteIndex(':memory:');
		// The layer is off in a vault with no `_hub/ai.md`; these tests are
		// about what happens once it is on.
		await vault.write('_hub/ai.md', '---\nenabled: true\n---\n');
		await vault.write(DAY_PATH, NOTE);
		index.put(DAY_PATH, NOTE, Date.now(), 'a');
	});

	afterEach(async () => {
		index.close();
		await rm(dir, { recursive: true, force: true });
	});

	it('reads the clock off the log, not off the plan', async () => {
		const facts = await gather(vault, index, DAY);
		expect(facts.firstMin).toBe(9 * 60 + 35);
		expect(facts.lastMin).toBe(12 * 60 + 15);
		expect(facts.loggedMinutes).toBe(140);
	});

	it('separates what was finished from what is still planned', async () => {
		const facts = await gather(vault, index, DAY);
		expect(facts.finished).toEqual(['Grading walkthrough']);
		expect(facts.planned).toEqual(['Write the requirements up']);
	});

	it('drafts from the note alone when no model runs', async () => {
		await vault.write('_hub/ai.md', '---\nenabled: false\n---\n');
		const result = await draft(vault, index, DAY);
		expect(result.text).toContain('09:35 Start');
		expect(result.text).toContain('Grading walkthrough');
		expect(result.proposal).toBeNull();
	});

	it('never writes the timesheet, and proposes only the scratch note', async () => {
		const result = await draft(vault, index, DAY, { cli: { executable: '/nonexistent/claude', vaultPath: dir } });
		expect(result.proposal?.edits).toHaveLength(1);
		expect(result.proposal?.edits[0].path).toBe(draftPath(DAY));
		// The CLI failed, so the draft is the day's own lines. That is the point.
		expect(result.text).toContain('Grading walkthrough');
	});

	it('still drafts a day with nothing in it', async () => {
		const empty = new NoteIndex(':memory:');
		const result = await draft(vault, empty, '2026-09-19');
		empty.close();
		expect(result.text).toBe('# 19/09/2026\n');
		expect(result.proposal).toBeNull();
	});
});
