import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTimesheet, timesheetFor, type TimesheetDay } from './timesheet';
import { Vault } from './vault/index';
import { config } from './config';

/**
 * The fixture reproduces the syntax of the real timesheets line for line —
 * `1)` numbering, the suffix-keyword clock lines, tab-indented sub-items, a
 * `### Timetracker` sub-heading, a fenced narrative that contains its own
 * numbered plan, a table, and the trailing `**BLOCKERS:**` — with the wording
 * replaced. The real files are also parsed at the bottom of this file when a
 * vault is attached.
 */
const SHEET = [
	'# 01/09/2026',
	'09:15 AM Start',
	'Break',
	'Leave',
	'## Tasks to do',
	'1) Look at the user requirements branch',
	'   ',
	'2) Read the standards and note contradictions',
	'3) Create the templates repo',
	'',
	'4) Take ownership of the pipeline, ',
	'## What\'s been done',
	'1) **Walkthrough session** and the write-up',
	'2) PR #2097 review',
	'```',
	'Today I plan to review pull requests and find more bugs.',
	'',
	'1) Review PRs 1 Hour PARTIALLY DONE',
	'2) Set up the pipeline, 3 Hours DONE',
	'```',
	'',
	'**BLOCKERS:**',
	'# 02/09/2026',
	'09:40 AM Start',
	'1 Hour off Break',
	'6:30 PM Leave',
	'## Tasks to do',
	'1) 1Password',
	'2) Integration across apps ',
	'\t1) End-to-end tests',
	'\t2) Commit the implementation',
	'3) Last one',
	'## What\'s been done',
	'### Timetracker',
	'```',
	'10:20 AM - Arrived at office',
	'11:00 AM - Catch-up',
	'```',
	'',
	'**BLOCKERS:** documents, and a login to check the bug',
	'',
	'| ID | Title |',
	'| --- | --- |',
	'| F-ISS-1 | Requirement issue |',
	'# 30/02/2026',
	'(NO BREAK TAKEN)',
	''
].join('\n');

const sheet = parseTimesheet(SHEET);
const day = (heading: string): TimesheetDay => {
	const found = sheet.days.find((d) => d.heading === heading);
	if (!found) throw new Error(`no day ${heading}`);
	return found;
};

describe('parseTimesheet', () => {
	it('finds one day per `# DD/MM/YYYY` heading and dates it', () => {
		expect(sheet.days.map((d) => [d.heading, d.date])).toEqual([
			['01/09/2026', '2026-09-01'],
			['02/09/2026', '2026-09-02'],
			// A heading that is not a calendar day still parses, as a day with
			// no date. Dropping it would hide a typo the user should see.
			['30/02/2026', null]
		]);
	});

	it('reads the clock lines by their keyword suffix, not as times', () => {
		expect(day('01/09/2026').clock).toEqual([
			{ label: 'start', value: '09:15 AM', raw: '09:15 AM Start', line: 1 },
			{ label: 'break', value: '', raw: 'Break', line: 2 },
			{ label: 'leave', value: '', raw: 'Leave', line: 3 }
		]);
		expect(day('02/09/2026').clock.map((c) => [c.label, c.value])).toEqual([
			['start', '09:40 AM'],
			// `1 Hour off Break` is a real line: the value is free text.
			['break', '1 Hour off'],
			['leave', '6:30 PM']
		]);
	});

	it('keeps a clock line it cannot read rather than dropping it', () => {
		const odd = day('30/02/2026');
		expect(odd.clock).toEqual([]);
		expect(odd.sections[0].blocks[0].text).toBe('(NO BREAK TAKEN)');
	});

	it('takes the sections in file order, whatever they are called', () => {
		expect(day('02/09/2026').sections.map((s) => [s.level, s.heading])).toEqual([
			[2, 'Tasks to do'],
			[2, "What's been done"],
			[3, 'Timetracker']
		]);
	});

	it('reads `1)` items, which markdown does not see as a list at all', () => {
		const tasks = day('01/09/2026').sections[0];
		expect(tasks.items.map((i) => [i.number, i.text])).toEqual([
			[1, 'Look at the user requirements branch'],
			[2, 'Read the standards and note contradictions'],
			[3, 'Create the templates repo'],
			// Trailing comma and space are how the user wrote it.
			[4, 'Take ownership of the pipeline,']
		]);
	});

	it('nests a tab-indented item under the one above it', () => {
		const tasks = day('02/09/2026').sections[0];
		expect(tasks.items.map((i) => i.number)).toEqual([1, 2, 3]);
		expect(tasks.items[1].children.map((c) => c.text)).toEqual(['End-to-end tests', 'Commit the implementation']);
		expect([tasks.items[1].line, tasks.items[1].endLine]).toEqual([28, 30]);
	});

	it('keeps a fenced narrative whole instead of reading its numbers as items', () => {
		const done = day('01/09/2026').sections[1];
		expect(done.items.map((i) => i.number)).toEqual([1, 2]);
		expect(done.blocks).toHaveLength(1);
		expect(done.blocks[0].fenced).toBe(true);
		expect(done.blocks[0].text).toContain('1) Review PRs 1 Hour PARTIALLY DONE');
	});

	it('pulls out the blockers line, so an empty one can be said plainly', () => {
		expect(day('01/09/2026').blockers).toBe('');
		expect(day('02/09/2026').blockers).toBe('documents, and a login to check the bug');
		expect(day('30/02/2026').blockers).toBe(null);
	});

	it('keeps a table, which belongs to no section the parser models', () => {
		const timetracker = day('02/09/2026').sections[2];
		expect(timetracker.blocks.map((b) => b.fenced)).toEqual([true, false]);
		expect(timetracker.blocks[1].text.split('\n')).toHaveLength(3);
	});

	it('spans each day up to the line before the next heading', () => {
		expect([day('01/09/2026').line, day('01/09/2026').endLine]).toEqual([0, 21]);
		expect(day('02/09/2026').line).toBe(22);
	});

	it('returns no days for a note that is not a timesheet', () => {
		expect(parseTimesheet('# Handbook\n\nSome prose.\n').days).toEqual([]);
		expect(parseTimesheet('').days).toEqual([]);
	});

	it('ignores a day heading inside a fence, as the narratives contain them', () => {
		const fenced = parseTimesheet(['# 01/09/2026', '```', '# 05/09/2026', '```'].join('\n'));
		expect(fenced.days.map((d) => d.heading)).toEqual(['01/09/2026']);
	});
});

describe('timesheetFor', () => {
	let root: string;
	let vault: Vault;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-timesheet-'));
		vault = new Vault(root);
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	const write = () => vault.write(`${config.timesheet.folder}/TIMESHEET SEPTEMBER.md`, SHEET);

	it('finds the day in whichever note holds it', async () => {
		await write();
		const view = await timesheetFor(vault, '2026-09-02');
		expect(view.day?.heading).toBe('02/09/2026');
		expect(view.path).toBe(`${config.timesheet.folder}/TIMESHEET SEPTEMBER.md`);
		expect(view.notes[0]).toMatchObject({ title: 'TIMESHEET SEPTEMBER', days: 3, latest: '2026-09-02' });
	});

	it('is an empty view, not an error, when the day has not been written', async () => {
		await write();
		const view = await timesheetFor(vault, '2026-09-04');
		expect(view.day).toBe(null);
		// The note is still offered, and so is the last day that does exist.
		expect(view.path).not.toBe(null);
		expect(view.previous).toMatchObject({ date: '2026-09-02', heading: '02/09/2026' });
	});

	it('is an empty view when the vault has no timesheet at all', async () => {
		await vault.write('Work/Handbook.md', '# Handbook\n');
		const view = await timesheetFor(vault, '2026-09-02');
		expect(view).toMatchObject({ day: null, path: null, previous: null, notes: [] });
		expect(view.folder).toBe(config.timesheet.folder);
	});

	it('looks only where it is told, so one workspace cannot read another’s', async () => {
		await write();
		const view = await timesheetFor(vault, '2026-09-02', ['Someone Else']);
		expect(view.day).toBe(null);
		expect(view.folder).toBe('Someone Else');
	});

	it('ignores notes in the folder that are not timesheets', async () => {
		await write();
		await vault.write(`${config.timesheet.folder}/Meeting notes.md`, '# 01/09/2026\nNot a timesheet\n');
		const view = await timesheetFor(vault, '2026-09-01');
		expect(view.notes.map((n) => n.title)).toEqual(['TIMESHEET SEPTEMBER']);
	});
});

/**
 * The same safety property the task parser has, for a document that must never
 * be rewritten: every non-blank line of a day is represented somewhere in the
 * parse. The only lines allowed to vanish are the fence markers themselves,
 * which the block carries as a flag instead.
 *
 *     VAULT_PATH=~/vault npm test
 */
const VAULT = process.env.VAULT_PATH ?? '';
const ENABLED = Boolean(VAULT) && existsSync(VAULT);

function timesheetFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry.startsWith('.') || entry === 'node_modules') continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) timesheetFiles(path, out);
		else if (/^TIMESHEET.*\.md$/i.test(entry)) out.push(path);
	}
	return out;
}

/** Every string the parse claims to have read, for the coverage check. */
function accounted(day: TimesheetDay): string[] {
	const out: string[] = [day.heading];
	for (const clock of day.clock) out.push(clock.raw.trim());
	if (day.blockers !== null) out.push(day.blockers);
	const walk = (items: TimesheetDay['sections'][number]['items']) => {
		for (const item of items) {
			out.push(...item.text.split('\n'));
			walk(item.children);
		}
	};
	for (const section of day.sections) {
		out.push(section.heading);
		walk(section.items);
		for (const block of section.blocks) out.push(...block.text.split('\n').map((l) => l.trim()));
	}
	return out;
}

describe.skipIf(!ENABLED)('the real timesheets', () => {
	const files = ENABLED ? timesheetFiles(VAULT) : [];
	const parsed = files.map((path) => ({ path, content: readFileSync(path, 'utf8') }));

	it('finds the monthly notes and a working day in each', () => {
		expect(files.length).toBeGreaterThan(0);
		const days = parsed.flatMap((p) => parseTimesheet(p.content).days);
		expect(days.length).toBeGreaterThan(30);
		expect(days.filter((d) => d.date === null)).toEqual([]);
	});

	it('loses no line of any day but the fence markers', () => {
		const lost: string[] = [];
		for (const { path, content } of parsed) {
			const lines = content.split('\n');
			for (const day of parseTimesheet(content).days) {
				const seen = new Set(accounted(day).map((s) => s.trim()));
				for (let i = day.line; i <= day.endLine; i++) {
					const text = lines[i].trim();
					if (!text || /^(```|~~~)/.test(text)) continue;
					// Headings lose their `#`s and items their number, so compare
					// against the line stripped the same way the parser strips it.
					const bare = text
						.replace(/^#{1,6}[ \t]+/, '')
						.replace(/^\d{1,3}[).][ \t]*/, '')
						// The blockers label is represented by the field, not the text.
						.replace(/^\*{0,2}BLOCKERS?:?\*{0,2}[ \t]*/i, '');
					if (!bare || seen.has(bare) || seen.has(text)) continue;
					lost.push(`${path}:${i + 1}: ${text}`);
				}
			}
		}
		expect(lost).toEqual([]);
	});
});
