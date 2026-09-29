import { test, expect } from '@playwright/test';
import { lineWith, resetVault, TODAY, vaultFile, waitForFile } from './helpers';

const GOALS = 'Study/Goals.md';
const SESSIONS = 'Study/Sessions.md';
const CARDS = 'Study/Flashcards.md';
const RESOURCE = 'Study/Resources/Video. Pointers explained.md';

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

test.describe('Study overview', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/study');
	});

	test('shows the one card due, ready to review', async ({ page }) => {
		await expect(page.getByTestId('due-count')).toHaveText('1');
		await expect(page.getByTestId('review-link')).toBeVisible();
	});

	test('shows each goal’s progress', async ({ page }) => {
		const goals = page.getByTestId('goal');
		await expect(goals.filter({ hasText: 'Pass AWS Solutions Architect' })).toContainText('1 of 2');
		await expect(goals.filter({ hasText: 'Read three papers a month' })).toContainText('0 of 2');
		// The first goal's undone milestone is next, with its due date.
		await expect(goals.filter({ hasText: 'Pass AWS Solutions Architect' })).toContainText('Two practice exams');
	});

	test('shows this week’s time against the weekly target', async ({ page }) => {
		const start = weekStartOf(TODAY);
		const sessions = [
			{ day: shift(TODAY, -1), minutes: 30 },
			{ day: TODAY, minutes: 90 }
		];
		const weekMinutes = sessions.filter((s) => s.day >= start).reduce((sum, s) => sum + s.minutes, 0);
		await expect(page.getByTestId('week-time')).toHaveText(`${formatDuration(weekMinutes)} of 6h`);
	});

	test('counts the streak of consecutive days with a session', async ({ page }) => {
		// Yesterday and today both have one: two days running.
		await expect(page.getByTestId('streak')).toContainText('2 days in a row');
	});
});

test.describe('Goals', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/study/goals');
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
		await page.getByTestId('milestone-goal').selectOption('Read three papers a month');
		await page.getByTestId('milestone-text').fill('Paper three');
		await page.getByTestId('add-milestone').click();

		expect(await waitForFile(GOALS, (c) => c.includes('- [ ] Paper three'))).toBe(true);
		// Landed right after the goal's other milestones, not at the end of the file.
		const lines = vaultFile(GOALS).split('\n');
		const at = lines.indexOf('- [ ] Paper three');
		expect(lines[at - 1]).toBe('- [ ] Paper two');
	});
});

test.describe('Sessions', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/study/sessions');
	});

	test('logging a session appends the exact expected line', async ({ page }) => {
		await page.getByTestId('session-topic').selectOption('Study');
		await page.getByTestId('session-minutes').fill('45');
		await page.getByTestId('session-note').fill('a note about it');
		await page.getByTestId('log-session').click();

		const expected = `- ${TODAY} 45m [[Study]] a note about it`;
		expect(await waitForFile(SESSIONS, (c) => c.includes(expected))).toBe(true);
	});

	test('shows hours per topic this month', async ({ page }) => {
		// Both sessions count only when they fall in the same calendar month;
		// near a month boundary, yesterday's may not.
		const month = TODAY.slice(0, 7);
		const sessions = [
			{ day: shift(TODAY, -1), minutes: 30 },
			{ day: TODAY, minutes: 90 }
		];
		const minutes = sessions.filter((s) => s.day.slice(0, 7) === month).reduce((sum, s) => sum + s.minutes, 0);

		await expect(page.getByTestId('topic-hours')).toContainText('Algorithms');
		await expect(page.getByTestId('topic-hours')).toContainText(formatDuration(minutes));
	});

	test('draws eight bars, one per week', async ({ page }) => {
		await expect(page.getByTestId('week-chart').locator('path.bar, .bar')).toHaveCount(8);
	});
});

test.describe('Flashcard review', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/study/review');
	});

	test('grades the due card and writes the plugin’s own comment', async ({ page }) => {
		await expect(page.getByTestId('card-question')).toContainText('What does SM-2 schedule');
		await page.getByTestId('card').click();
		await expect(page.getByTestId('card-answer')).toContainText('The day a card is next due');

		await page.getByTestId('grade-good').click();

		// Three days late at interval 4, ease 270: (4 + 3/2) * 2.7 = 14.85 -> 15.
		expect(await waitForFile(CARDS, (c) => c.includes(`<!--SR:!${shift(TODAY, 15)},15,270-->`))).toBe(true);
		await expect(page.getByTestId('review-done')).toContainText('Done for today');
	});
});

test.describe('Reading list', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/study/resources');
	});

	test('starts a queued resource, writing one line of frontmatter', async ({ page }) => {
		const before = vaultFile(RESOURCE).split('\n');
		const row = page.getByTestId('resource').filter({ hasText: 'Pointers explained' });
		await expect(page.getByTestId('resource-group-queued')).toContainText('Pointers explained');

		await row.locator('select').selectOption('learning');

		expect(await waitForFile(RESOURCE, (c) => c.includes('status: learning'))).toBe(true);
		const after = vaultFile(RESOURCE).split('\n');
		expect(after.filter((l) => !l.startsWith('status:'))).toEqual(before);
		await expect(page.getByTestId('resource-group-learning')).toContainText('Pointers explained');
	});
});

test.describe('Phone layout', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('Study is reached from the More sheet, and the review session fits', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/notes');

		await page.getByTestId('tab-more').click();
		// The workspace fixture is also called "Study", so the module link is
		// found by its href rather than by its (ambiguous) accessible name.
		await page.locator('dialog.more a[href="/study"]').click();
		await expect(page).toHaveURL('/study');
		await expect(page.getByTestId('study-tabs')).toBeVisible();

		await page.goto('/study/review');
		await page.getByTestId('card').click();
		const grades = page.getByTestId('grades');
		await expect(grades).toBeVisible();
		const box = await grades.boundingBox();
		expect(box!.width).toBeLessThanOrEqual(390);
		expect(box!.width / 4).toBeGreaterThan(44);
	});
});
