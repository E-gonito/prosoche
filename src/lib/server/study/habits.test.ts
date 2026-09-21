import { describe, it, expect } from 'vitest';
import { habitKey, habitsFrom } from './habits';
import { scanTasks, toTask } from '../parse/task';

/** Lines copied from `Journal/Journal Template.md`, quirks included. */
const TEMPLATE = [
	'# Tasks',
	'- [ ] Morning stretch for 5 minutes `Q1`',
	'- [ ] Write the daily log for 10 minutes `Q1` ',
	'- [ ] Walk the dog & feed the cat, check food and water, clean alleyway `Q1`',
	'## Backlog',
	'```',
	'- [ ] Renew the passport `Q2`',
	'```'
].join('\n');

const tasks = (content: string, path: string) => scanTasks(content).map((t) => toTask(t, path));
const template = tasks(TEMPLATE, 'Journal/Journal Template.md').filter((t) => !t.fenced);

const day = (date: string, lines: string[]) => ({
	day: date,
	exists: true,
	tasks: tasks(lines.join('\n'), `Journal/${date.replace(/-/g, '/')}.md`)
});
const missing = (date: string) => ({ day: date, exists: false, tasks: [] });

describe('habitsFrom', () => {
	it('takes the habit list from the template, and not from its fenced backlog', () => {
		const out = habitsFrom({ template, days: [day('2026-09-21', [])], today: '2026-09-21' });
		expect(out.map((h) => h.text)).toEqual([
			'Morning stretch for 5 minutes',
			'Write the daily log for 10 minutes',
			'Walk the dog & feed the cat, check food and water, clean alleyway'
		]);
	});

	it('matches the day’s line to the template through its time range', () => {
		const out = habitsFrom({
			template,
			days: [day('2026-09-21', ['- [x] 09:30 - 10:00 Morning stretch for 5 minutes `Q1`'])],
			today: '2026-09-21'
		});
		expect(out[0]).toMatchObject({ today: true, path: 'Journal/2026/09/21.md', line: 0 });
		expect(out[0].raw).toBe('- [x] 09:30 - 10:00 Morning stretch for 5 minutes `Q1`');
	});

	it('says nothing rather than "missed" for a habit today’s note never mentions', () => {
		const out = habitsFrom({ template, days: [day('2026-09-21', ['- [ ] Something else'])], today: '2026-09-21' });
		expect(out[0].today).toBeNull();
	});

	it('counts a streak back over the days that have a note', () => {
		const out = habitsFrom({
			template,
			days: [
				day('2026-09-18', ['- [x] Morning stretch for 5 minutes `Q1`']),
				missing('2026-09-19'),
				day('2026-09-20', ['- [x] Morning stretch for 5 minutes `Q1`']),
				day('2026-09-21', ['- [x] Morning stretch for 5 minutes `Q1`'])
			],
			today: '2026-09-21'
		});
		expect(out[0]).toMatchObject({ streak: 3, hit: 3, of: 3 });
	});

	it('does not break a streak on a today that is merely unfinished', () => {
		const out = habitsFrom({
			template,
			days: [
				day('2026-09-20', ['- [x] Morning stretch for 5 minutes `Q1`']),
				day('2026-09-21', ['- [ ] Morning stretch for 5 minutes `Q1`'])
			],
			today: '2026-09-21'
		});
		expect(out[0]).toMatchObject({ streak: 1, today: false, hit: 1, of: 2 });
	});

	it('breaks a streak on a day that was written and missed', () => {
		const out = habitsFrom({
			template,
			days: [
				day('2026-09-19', ['- [x] Morning stretch for 5 minutes `Q1`']),
				day('2026-09-20', ['- [ ] Morning stretch for 5 minutes `Q1`']),
				day('2026-09-21', ['- [x] Morning stretch for 5 minutes `Q1`'])
			],
			today: '2026-09-21'
		});
		expect(out[0]).toMatchObject({ streak: 1, hit: 2, of: 3 });
	});

	it('adopts a recurring task the template never mentioned', () => {
		const out = habitsFrom({
			template: [],
			days: [day('2026-09-21', ['- [x] Stretch 🔁 every day'])],
			today: '2026-09-21'
		});
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ text: 'Stretch', recurring: true, streak: 1 });
	});

	it('gives every day of the window a slot, so the strip has no gaps', () => {
		const out = habitsFrom({
			template,
			days: [missing('2026-09-20'), day('2026-09-21', [])],
			today: '2026-09-21'
		});
		expect(out[0].days.map((d) => d.done)).toEqual([null, null]);
		expect(out[0]).toMatchObject({ streak: 0, hit: 0, of: 0 });
	});
});

describe('habitKey', () => {
	it('sees through markdown, case, punctuation and the ampersand', () => {
		expect(habitKey('**Walk the dog & feed the cat**, check food')).toBe(habitKey('Walk the dog and feed the cat check food'));
	});

	it('keeps two different habits apart', () => {
		expect(habitKey('Morning stretch for 5 minutes')).not.toBe(habitKey('Morning stretch for 10 minutes'));
	});
});
