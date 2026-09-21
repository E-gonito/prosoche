/**
 * Fixtures for phase 6: the read-only timesheet, and a workspace whose tab
 * carries the three phase-6 widgets.
 *
 * The timesheet reproduces the syntax of the real one — `1)` numbering that
 * markdown does not see as a list, clock lines whose keyword is a suffix, a
 * tab-indented sub-item, a fenced narrative and a trailing `**BLOCKERS:**` —
 * with invented wording. Today's section is written for the day the suite
 * runs, so the widget has something to render.
 *
 * The workspace is deliberately a new one rather than phase 2's `atlas`,
 * whose file this must not overwrite, and it declares **no folders**: the
 * timesheet widget then falls back to the configured folder, and no note in
 * the fixture vault changes the workspace it belongs to.
 */

const MONTHS = [
	'JANUARY',
	'FEBRUARY',
	'MARCH',
	'APRIL',
	'MAY',
	'JUNE',
	'JULY',
	'AUGUST',
	'SEPTEMBER',
	'OCTOBER',
	'NOVEMBER',
	'DECEMBER'
];

/** `YYYY-MM-DD` to the `DD/MM/YYYY` the timesheet writes. */
const ddmmyyyy = (iso) => {
	const [y, m, d] = iso.split('-');
	return `${d}/${m}/${y}`;
};

export default async function ({ TODAY }) {
	const month = MONTHS[Number(TODAY.split('-')[1]) - 1];
	const pad = (n) => String(n).padStart(2, '0');
	const earlier = new Date(`${TODAY}T12:00:00`);
	earlier.setDate(earlier.getDate() - 1);
	const yesterday = `${earlier.getFullYear()}-${pad(earlier.getMonth() + 1)}-${pad(earlier.getDate())}`;

	return {
		[`Work/Atlas/TIMESHEET ${month}.md`]: [
			`# ${ddmmyyyy(yesterday)}`,
			'09:05 AM Start',
			'1 Hour off Break',
			'6:00 PM Leave',
			'## Tasks to do',
			"1) Yesterday's first thing",
			"2) Yesterday's second thing",
			"## What's been done",
			'1) Wrote the thing down',
			'',
			'**BLOCKERS:** none worth naming',
			'',
			`# ${ddmmyyyy(TODAY)}`,
			'09:35 AM Start',
			'Break',
			'Leave',
			'## Tasks to do',
			'1) Review the open pull requests',
			'   ',
			'2) Read the standards and note the contradictions',
			'3) Integration across the apps',
			'\t1) End-to-end tests',
			'\t2) Commit the implementation',
			'',
			"## What's been done",
			'1) **Walkthrough session** and the write-up',
			'2) Reviewed PR #2097',
			'```',
			'Today I plan to review pull requests and find more bugs.',
			'',
			'1) Review PRs 1 Hour PARTIALLY DONE',
			'2) Set up the pipeline, 3 Hours DONE',
			'```',
			'',
			'**BLOCKERS:**',
			''
		].join('\n'),

		'_hub/workspaces/polish.md': [
			'---',
			'name: Polish',
			'color: "#7c3aed"',
			'tag: ws/polish',
			'template: project',
			'tabs:',
			'  - title: Day',
			'    widgets: [timesheet, github, linear]',
			'---',
			'',
			'Where the phase 6 widgets live in the test vault.',
			''
		].join('\n')
	};
}
