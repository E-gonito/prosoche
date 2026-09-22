import { test, expect } from '@playwright/test';
import { TODAY, TODAY_NOTE, lineWith, resetVault, vaultFile, waitForFile } from './helpers';

const ADA = 'People/Ada Lovelace.md';

/** Start the timer through the API: the only control this phase ships is Stop. */
async function startTimer(request: { post: (url: string, opts?: unknown) => Promise<unknown> }, fragment: string) {
	const { index } = lineWith(TODAY_NOTE, fragment);
	expect(index).toBeGreaterThan(-1);
	await request.post('/api/timer', { data: { action: 'start', path: TODAY_NOTE, line: index } });
	return index;
}

test.describe('the timer', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test.afterEach(async ({ request }) => {
		await request.post('/api/timer', { data: { action: 'stop' } });
	});

	test('shows in the header, and keeps counting across a navigation', async ({ page, request }) => {
		await startTimer(request, 'Client project');
		await page.goto('/');

		await expect(page.getByTestId('timer')).toBeVisible();
		await expect(page.getByTestId('timer-task')).toHaveText('Client project');
		await expect(page.getByTestId('timer-elapsed')).toHaveText(/^\d+:\d\d$/);

		await page.locator('nav').getByRole('link', { name: 'Notes', exact: false }).click();
		await expect(page).toHaveURL(/\/notes$/);
		await expect(page.getByTestId('timer-task')).toHaveText('Client project');
	});

	test('shows nothing at all when none is running', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByTestId('timer')).toHaveCount(0);
	});

	test('stopping appends one line under ## Time log and creates the heading', async ({ page, request }) => {
		const before = vaultFile(TODAY_NOTE).split('\n');
		await startTimer(request, 'Client project');
		await page.goto('/');
		await page.getByTestId('timer-stop').click();

		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('## Time log'))).toBe(true);
		const after = vaultFile(TODAY_NOTE).split('\n');

		// Everything that was already in the note is untouched, in place.
		expect(after.slice(0, before.length - 1)).toEqual(before.slice(0, before.length - 1));
		expect(after.filter((l) => l === '## Time log')).toHaveLength(1);

		// The logged line is the one *under the heading*. Searching the whole
		// note for "Client project" finds the task it was timed against first,
		// which is a different line and must stay exactly as it was.
		const heading = after.indexOf('## Time log');
		const logged = after.slice(heading + 1).filter((l) => l.trim() !== '');
		expect(logged).toHaveLength(1);
		// With the workspace tag the alias resolved: the block carries no tag,
		// but the Client workspace names "Client project" in its `aliases:`, so
		// the record of the work says whose work it was.
		expect(logged[0]).toMatch(/^- \d\d:\d\d - \d\d:\d\d Client project \(\d+[hm]\S*\) #ws\/client$/);

		// The header goes back to showing nothing, after saying what it logged.
		await expect(page.getByTestId('timer-logged')).toBeVisible();
		await expect(page.getByTestId('timer')).toHaveCount(0);
	});

	test('a second start logs the first timer under the same heading', async ({ page, request }) => {
		await startTimer(request, 'Client project');
		await startTimer(request, 'Read a book');
		await page.goto('/');
		await expect(page.getByTestId('timer-task')).toHaveText('Read a book');

		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('Client project ('))).toBe(true);
		await page.getByTestId('timer-stop').click();
		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('Read a book ('))).toBe(true);

		const lines = vaultFile(TODAY_NOTE).split('\n');
		const heading = lines.indexOf('## Time log');
		expect(lines.filter((l) => l === '## Time log')).toHaveLength(1);
		expect(lines[heading + 1]).toContain('Client project');
		expect(lines[heading + 2]).toContain('Read a book');
		// The quadrant of the timed task travels onto the log line.
		expect(lines[heading + 2]).toContain('`Q2`');
	});
});

test.describe('the Time widget', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	/**
	 * The author's own week: timed blocks ticked off in the daily note, the
	 * timer never started. Wellbeing claims "Morning stretch" by alias, so the
	 * widget counts a block that carries no tag and was never edited.
	 */
	test('counts a ticked timed block as done, with no timer anywhere', async ({ page }) => {
		await page.goto('/w/wellbeing');

		await expect(page.getByTestId('done-total')).toHaveText('30m');
		await expect(page.getByTestId('logged-total')).toHaveText('0m');
		await expect(page.getByTestId('time-widget')).toContainText('of 30m planned');
		// Something happened this week, so the widget does not ask for a timer.
		await expect(page.getByText('Nothing ticked or timed')).toHaveCount(0);
		// Read, not written: the block still carries no tag.
		expect(lineWith(TODAY_NOTE, 'Morning stretch').text).toBe('- [x] 09:30 - 10:00 Morning stretch `Q1`');
	});

	test('says a week with neither a tick nor a timer is empty, and names both', async ({ page }) => {
		await page.goto('/w/errands');

		await expect(page.getByTestId('done-total')).toHaveText('0m');
		await expect(page.getByText('Nothing ticked or timed against Errands this week.')).toBeVisible();
		await expect(page.getByTestId('time-widget')).toContainText('Ticking a timed block counts as done');
	});
});

test.describe('a person', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto(`/people/${encodeURIComponent('Ada Lovelace')}`);
	});

	test('lists every note that links to them', async ({ page }) => {
		await expect(page.getByTestId('person-name')).toHaveText('Ada Lovelace');
		await expect(page.getByTestId('person-backlink')).toHaveCount(1);
		await expect(page.getByTestId('person-backlink')).toHaveText('Kickoff');
	});

	test('shows their open follow-ups, from their note and from elsewhere', async ({ page }) => {
		const rows = page.getByTestId('task-row');
		await expect(rows).toHaveCount(2);
		await expect(rows.filter({ hasText: 'Send the anonymisation plan' })).toBeVisible();
		await expect(rows.filter({ hasText: 'Draft the brief' })).toBeVisible();
		// Finished work is not a follow-up.
		await expect(rows.filter({ hasText: 'Return her book' })).toHaveCount(0);
	});

	test('shows their log, newest line last, as the file has it', async ({ page }) => {
		await expect(page.getByTestId('person-log')).toContainText('2026-09-14');
		await expect(page.getByTestId('person-log')).toContainText('Agreed the byte-level approach.');
	});

	test('logging a contact appends one dated line and nothing else', async ({ page }) => {
		const before = vaultFile(ADA).split('\n');
		await page.getByTestId('log-text').fill('Walked through the pipeline');
		await page.getByTestId('log-submit').click();

		expect(await waitForFile(ADA, (c) => c.includes('Walked through the pipeline'))).toBe(true);
		const after = vaultFile(ADA).split('\n');
		expect(after).toHaveLength(before.length + 1);

		const added = after.map((l, i) => (l === before[i] ? null : i)).filter((i) => i !== null);
		expect(after[added[0]!]).toBe(`- ${TODAY} Walked through the pipeline`);
		expect(after.toSpliced(added[0]!, 1)).toEqual(before);

		await expect(page.getByTestId('person-log')).toContainText('Walked through the pipeline');
	});

	test('with no note reads as a person with an empty note, and logging creates it', async ({ page }) => {
		await page.goto(`/people/${encodeURIComponent('Grace Hopper')}`);
		await expect(page.getByTestId('person-name')).toHaveText('Grace Hopper');
		await expect(page.getByText('No note yet for Grace Hopper')).toBeVisible();
		// She is only a wiki-link on a sub-bullet, which is enough to connect her.
		await expect(page.getByTestId('person-backlink')).toHaveText('Kickoff');
		await expect(page.getByTestId('task-row').filter({ hasText: 'Draft the brief' })).toBeVisible();

		await page.getByTestId('log-text').fill('Met at the conference');
		await page.getByTestId('log-submit').click();

		expect(await waitForFile('People/Grace Hopper.md', (c) => c.includes('Met at the conference'))).toBe(true);
		const note = vaultFile('People/Grace Hopper.md');
		expect(note).toContain('type: person');
		expect(note).toContain(`## Log\n- ${TODAY} Met at the conference`);
		await expect(page.getByText('No note yet for')).toHaveCount(0);
	});

	test('refuses an empty contact instead of writing a stray line', async ({ page }) => {
		const before = vaultFile(ADA);
		await page.getByTestId('log-submit').click();
		await expect(page.getByTestId('log-problem')).toBeVisible();
		expect(vaultFile(ADA)).toBe(before);
	});
});
