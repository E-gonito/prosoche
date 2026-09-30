import { test, expect, type Page } from '@playwright/test';
import { lineWith, resetVault, TODAY, vaultFile, waitForFile } from './helpers';

/**
 * Study, against `fixtures/study.mjs`: one subject, the base vault's `study`
 * workspace, homed at `Study/`, so its pages are under `/study/study`.
 */

const BASE = '/study/study';
const GOALS = 'Study/Goals.md';
const SESSIONS = 'Study/Sessions.md';
const READING = 'Study/Reading List.md';
const AWS = 'Pass AWS Solutions Architect';
const PAPERS = 'Read three papers a month';

/** `YYYY-MM-DD`, `offset` days from `from`, matching `e2e/fixtures/study.mjs`. */
function shift(from: string, offset: number): string {
	const at = new Date(`${from}T00:00:00Z`);
	at.setUTCDate(at.getUTCDate() + offset);
	return at.toISOString().slice(0, 10);
}

/** Mirrors `weekStart` in `src/lib/server/study/sessions.ts`. */
function weekStartOf(dayKey: string): string {
	const at = new Date(`${dayKey}T00:00:00Z`);
	const back = (at.getUTCDay() + 6) % 7;
	at.setUTCDate(at.getUTCDate() - back);
	return at.toISOString().slice(0, 10);
}

/** Mirrors `formatDuration` in `src/lib/shared/duration.ts`, with the gap Overview uses. */
function formatDuration(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (!hours) return `${rest}m`;
	return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** The fixture's two goal sessions, yesterday and today, both on AWS. */
const weekMinutes = () => {
	const start = weekStartOf(TODAY);
	return [
		{ day: shift(TODAY, -1), minutes: 30 },
		{ day: TODAY, minutes: 90 }
	]
		.filter((s) => s.day >= start)
		.reduce((sum, s) => sum + s.minutes, 0);
};

const item = (page: Page, title: string) => page.getByTestId('reading-item').filter({ hasText: title });

test.describe('Study index', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/study');
	});

	test('shows each subject with its goals', async ({ page }) => {
		const subject = page.getByTestId('subject-card');
		await expect(subject).toHaveCount(1);
		await expect(subject).toContainText(AWS);
		await expect(subject).toContainText('1/2');
		await expect(page.getByTestId('sub-study')).toContainText('Study');
	});

	test('New subject writes a subject file homed at Study/<name> and opens it', async ({ page }) => {
		await page.getByTestId('subject-name').fill('Filipino');
		await page.getByTestId('subject-folders').fill('Languages/Filipino');
		await page.getByTestId('create-subject').click();

		await expect(page).toHaveURL('/study/filipino');
		const file = vaultFile('_hub/subjects/filipino.md');
		expect(file).toContain('\nfolders:\n  - "Study/Filipino"\n  - "Languages/Filipino"\n');
		expect(vaultFile('_hub/workspaces/filipino.md')).toBe('');
		// Every tab shows, even for a subject with nothing in it yet.
		await expect(page.getByTestId('study-tabs').getByRole('link')).toHaveText(['Overview', 'Notes', 'Goals', 'Reading list', 'Sessions']);
	});


	test('an old single-subject address opens that tab of the only subject', async ({ page }) => {
		await page.goto('/study/resources');
		await expect(page).toHaveURL(`${BASE}/reading`);
		await page.goto('/study/goals');
		await expect(page).toHaveURL(`${BASE}/goals`);
	});
});

test.describe('Subject overview', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto(BASE);
	});


	test('shows each goal’s milestones, hours and reading', async ({ page }) => {
		const aws = page.getByTestId('goal').filter({ hasText: AWS });
		await expect(aws).toContainText('1 of 2');
		await expect(aws).toContainText('Two practice exams');
		await expect(aws.getByTestId('goal-hours')).toHaveText(`${formatDuration(weekMinutes())} this week`);
		await expect(aws.getByTestId('goal-reading')).toContainText('AWS whitepapers');
		await expect(page.getByTestId('goal').filter({ hasText: PAPERS })).toContainText('0 of 2');
	});

	test('shows this week’s time against the weekly target, and the streak', async ({ page }) => {
		await expect(page.getByTestId('week-time')).toHaveText(`${formatDuration(weekMinutes())} of 6h`);
		await expect(page.getByTestId('streak')).toContainText('2 days in a row');
	});
});

test.describe('Goals', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto(`${BASE}/goals`);
	});

	test('ticking a milestone changes exactly that line', async ({ page }) => {
		const before = vaultFile(GOALS).split('\n');
		const { index } = lineWith(GOALS, 'Two practice exams');

		await page.getByTestId('milestone').filter({ hasText: 'Two practice exams' }).locator('input').click();

		expect(await waitForFile(GOALS, (c) => c.split('\n')[index] === '- [x] Two practice exams 📅 2026-11-20')).toBe(true);
		const after = vaultFile(GOALS).split('\n');
		const changed = after.map((l, i) => (l === before[i] ? null : i)).filter((i) => i !== null);
		expect(changed).toEqual([index]);
	});

	test('adding a goal appends a new heading', async ({ page }) => {
		await page.getByTestId('goal-title').fill('Learn Rust');
		await page.getByTestId('goal-target').fill('2027-01-01');
		await page.getByTestId('add-goal').click();

		expect(await waitForFile(GOALS, (c) => c.includes('## Learn Rust'))).toBe(true);
		expect(vaultFile(GOALS)).toContain('## Learn Rust\ntarget:: 2027-01-01\n');
		await expect(page.getByTestId('goal').filter({ hasText: 'Learn Rust' })).toBeVisible();
	});

	test('adding a milestone appends it under its goal', async ({ page }) => {
		await page.getByTestId('milestone-goal').selectOption(PAPERS);
		await page.getByTestId('milestone-text').fill('Paper three');
		await page.getByTestId('add-milestone').click();

		expect(await waitForFile(GOALS, (c) => c.includes('- [ ] Paper three'))).toBe(true);
		const lines = vaultFile(GOALS).split('\n');
		const at = lines.indexOf('- [ ] Paper three');
		expect(lines[at - 1]).toBe('- [ ] Paper two');
	});
});

test.describe('Reading list', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto(`${BASE}/reading`);
	});

	test('shows the file’s columns as groups, with each item’s kind and goal', async ({ page }) => {
		await expect(page.getByTestId('reading-group')).toHaveCount(2);
		await expect(item(page, 'Pointers explained')).toContainText('video');
		await expect(item(page, 'AWS whitepapers')).toContainText(AWS);
		await expect(item(page, 'AWS whitepapers').getByRole('link')).toHaveAttribute('href', 'https://aws.amazon.com/whitepapers');
	});

	test('adding an item writes one card line into its group', async ({ page }) => {
		const before = vaultFile(READING);
		await page.getByTestId('add-title').fill('CS:APP');
		await page.getByTestId('add-url').fill('https://csapp.cs.cmu.edu');
		await page.getByTestId('add-kind').selectOption('book');
		await page.getByTestId('add-goal').selectOption(PAPERS);
		await page.getByTestId('add-group').selectOption({ label: 'Paused' });
		await page.getByTestId('add-item').click();

		const line = `- [ ] [CS:APP](https://csapp.cs.cmu.edu) [[Goals#${PAPERS}]] #book`;
		expect(await waitForFile(READING, (c) => c.includes(line))).toBe(true);
		expect(vaultFile(READING)).toBe(before.replace('## Paused\n\n', `## Paused\n\n${line}\n`));
		await expect(item(page, 'CS:APP')).toBeVisible();
	});

	test('editing an item’s kind and goal rewrites only its line', async ({ page }) => {
		const before = vaultFile(READING);
		await item(page, 'The Pragmatic Programmer').getByTestId('item-menu').click();
		await page.getByTestId('item-edit').click();
		const form = page.getByTestId('reading-edit');
		await form.getByTestId('edit-kind').selectOption('course');
		await form.getByTestId('edit-goal').selectOption(AWS);
		await form.getByTestId('edit-save').click();

		const line = `- [ ] The Pragmatic Programmer [[Goals#${AWS}]] #course`;
		expect(await waitForFile(READING, (c) => c.includes(line))).toBe(true);
		expect(vaultFile(READING)).toBe(before.replace('- [ ] The Pragmatic Programmer #book', line));
	});

	test('moving an item to Done ticks it, and Move up reorders a group', async ({ page }) => {
		await item(page, 'Pointers explained').getByTestId('item-status').selectOption({ label: 'Done' });
		expect(await waitForFile(READING, (c) => c.includes('**Complete**\n- [x] [Pointers explained]'))).toBe(true);

		await page.getByTestId('add-title').fill('Second');
		await page.getByTestId('add-item').click();
		await expect(item(page, 'Second')).toBeVisible();
		await item(page, 'Second').getByTestId('item-menu').click();
		await page.getByTestId('item-up').click();
		// Book is the add form's first kind.
		expect(await waitForFile(READING, (c) => c.includes('## To read\n\n- [ ] Second #book\n- [ ] The Pragmatic Programmer #book\n'))).toBe(true);
	});

	test('deleting an item asks twice and removes only its line', async ({ page }) => {
		const before = vaultFile(READING);
		await item(page, 'The Pragmatic Programmer').getByTestId('item-menu').click();
		await page.getByTestId('item-delete').click();
		await page.getByTestId('delete-confirm').click();
		expect(await waitForFile(READING, (c) => c === before.replace('- [ ] The Pragmatic Programmer #book\n', ''))).toBe(true);
	});
});

test.describe('Sessions', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto(`${BASE}/sessions`);
	});

	test('logging a session against a goal appends the exact expected line', async ({ page }) => {
		await page.getByTestId('session-goal').selectOption(PAPERS);
		await page.getByTestId('session-minutes').fill('45');
		await page.getByTestId('session-note').fill('a note about it');
		await page.getByTestId('log-session').click();

		const expected = `- ${TODAY} 45m [[Goals#${PAPERS}]] a note about it`;
		expect(await waitForFile(SESSIONS, (c) => c.includes(expected))).toBe(true);
	});

	test('shows hours per goal this month, and an old topic as it is written', async ({ page }) => {
		const month = TODAY.slice(0, 7);
		const minutes = [
			{ day: shift(TODAY, -1), minutes: 30 },
			{ day: TODAY, minutes: 90 }
		]
			.filter((s) => s.day.slice(0, 7) === month)
			.reduce((sum, s) => sum + s.minutes, 0);

		await expect(page.getByTestId('goal-hours')).toContainText(AWS);
		await expect(page.getByTestId('goal-hours')).toContainText(formatDuration(minutes));
		await expect(page.getByTestId('session-log')).toContainText('[[Algorithms]]');
	});

	test('draws eight bars, one per week', async ({ page }) => {
		await expect(page.getByTestId('week-chart').locator('path.bar, .bar')).toHaveCount(8);
	});
});


test.describe('Phone layout', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('Study is reached from the More sheet', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/notes');

		await page.getByTestId('tab-more').click();
		// The workspace fixture is also called "Study", so the module link is
		// found by its href rather than by its (ambiguous) accessible name.
		await page.locator('dialog.more a[href="/study"]').click();
		await expect(page).toHaveURL('/study');
		await expect(page.getByTestId('subject-card')).toBeVisible();
	});
});

test.describe('A subject’s Notes tab', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('browses the subject’s folders and reads a note in place', async ({ page }) => {
		await page.goto('/study/study/notes');
		const tree = page.getByTestId('subject-tree');
		await expect(tree).toContainText('Study');
		await tree.getByRole('link', { name: 'Algorithms' }).click();
		await expect(page).toHaveURL(/\/study\/study\/notes\?note=Study%2FAlgorithms\.md$/);
		await expect(page.getByTestId('subject-note-body')).toBeVisible();

		await page.getByTestId('subject-notes-filter').fill('syllab');
		await expect(tree.getByRole('link')).toHaveCount(1);
		await expect(tree.getByRole('link')).toContainText('Syllabus');
	});

	test('will not open a note from outside the subject', async ({ page }) => {
		await page.goto(`/study/study/notes?note=${encodeURIComponent('Work/Tasks.md')}`);
		await expect(page.getByTestId('subject-note-body')).toHaveCount(0);
		await expect(page.locator('.reader')).toContainText('not in Study');
	});
});
