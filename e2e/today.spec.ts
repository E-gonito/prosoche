import { test, expect } from '@playwright/test';
import { TODAY, TODAY_NOTE, centreBlock, dragTo, minutes, resetVault, vaultFile, waitForFile } from './helpers';

/** Mirrors `e2e/fixtures/today.mjs`'s own date arithmetic. */
function shiftDay(day: string, offset: number): string {
	const [y, m, d] = day.split('-').map(Number);
	const date = new Date(y, m - 1, d + offset);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
const FUTURE = shiftDay(TODAY, 2);

test.describe('Today', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/');
	});

	test('redirects the root of the app to Today', async ({ page }) => {
		await expect(page).toHaveURL(/\/today$/);
		await expect(page.getByTestId('today-title')).toBeVisible();
	});

	test('renders the day\'s scheduled and unscheduled tasks', async ({ page }) => {
		await expect(page.getByTestId('block').filter({ hasText: 'Morning stretch' })).toBeVisible();
		await expect(page.getByTestId('unscheduled').getByTestId('task-row').filter({ hasText: 'Walk the dog' })).toBeVisible();
	});

	test('ticking a task writes exactly one character to the note', async ({ page }) => {
		const before = vaultFile(TODAY_NOTE).split('\n');
		const row = page.getByTestId('unscheduled').getByTestId('task-row').filter({ hasText: 'Twenty push ups' });
		await row.getByTestId('checkbox').click();

		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('- [x] Twenty push ups'))).toBe(true);
		const after = vaultFile(TODAY_NOTE).split('\n');
		const changed = after.map((l, i) => (l === before[i] ? null : i)).filter((i) => i !== null);
		expect(changed).toHaveLength(1);
	});

	test('dragging a block rewrites only its time', async ({ page }) => {
		const before = vaultFile(TODAY_NOTE).split('\n');
		const from = await centreBlock(page, 'Read a book');
		await dragTo(page, from, { x: from.x, y: from.y + minutes(60) });

		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('15:00 - 15:30 Read a book'))).toBe(true);
		const after = vaultFile(TODAY_NOTE).split('\n');
		const changed = after.map((l, i) => (l === before[i] ? null : i)).filter((i) => i !== null);
		expect(changed).toHaveLength(1);
		expect(after[changed[0]!]).toBe('- [ ] 15:00 - 15:30 Read a book `Q2`');
	});

	test('quick capture appends to the inbox', async ({ page }) => {
		const capture = page.getByTestId('unscheduled').getByTestId('capture-row');
		await capture.getByLabel('Quick capture').fill('buy stamps');
		await capture.getByRole('button', { name: 'Add' }).click();
		expect(await waitForFile('Inbox/Capture.md', (c) => c.includes('buy stamps'))).toBe(true);
	});

	test('overdue lists a past-due task from a workspace note, and can plan it for today', async ({ page }) => {
		const overdue = page.getByTestId('overdue');
		await expect(overdue).toContainText('Chase the overdue invoice');
		await expect(overdue.getByTestId('task-due')).toContainText('2000-01-01');

		await overdue.getByTestId('task-row').filter({ hasText: 'Chase the overdue invoice' }).getByTestId('add-to-today').click();
		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('Chase the overdue invoice'))).toBe(true);
	});

	test('an overdue board card shows in Overdue, and ticking it ticks it in Board.md', async ({ page }) => {
		const row = page.getByTestId('overdue').getByTestId('board-card-row').filter({ hasText: 'Draft the proposal' });
		await expect(row.getByTestId('board-card-due')).toHaveText('1 Jan 2000');
		await row.getByTestId('board-card-done').click();
		expect(await waitForFile('Work/Board.md', (c) => c.includes('- [x] Draft the proposal @{2000-01-01}'))).toBe(true);
		await expect(page.getByTestId('overdue').getByTestId('board-card-row').filter({ hasText: 'Draft the proposal' })).toHaveCount(0);
	});

	test('has no rest-of-the-week section; another day opens through Next day', async ({ page }) => {
		await expect(page.getByTestId('week')).toHaveCount(0);
		await page.goto(`/today/${FUTURE}`);
		await expect(page.getByTestId('unscheduled')).toContainText('Prep the demo for Thursday');
	});

	test('prev and next move by one day, and Today jumps back', async ({ page }) => {
		await page.getByLabel('Next day').click();
		await expect(page).toHaveURL(/\/today\/\d{4}-\d{2}-\d{2}$/);
		await expect(page.getByRole('main').getByRole('link', { name: 'Today' })).toBeVisible();

		await page.getByLabel('Previous day').click();
		await page.getByLabel('Previous day').click();
		await expect(page).toHaveURL(/\/today\/\d{4}-\d{2}-\d{2}$/);

		await page.getByRole('main').getByRole('link', { name: 'Today' }).click();
		await expect(page).toHaveURL(/\/today$/);
	});

	test('a calendar not configured is quiet rather than an error', async ({ page }) => {
		// HUB_GCAL_ICS is unset in the e2e server, the normal case.
		await expect(page.getByTestId('today-title')).toBeVisible();
		await expect(page.getByTestId('block')).toHaveCount(4);
	});

	test('AI being off shows a calm hint rather than a broken button', async ({ page }) => {
		const briefing = page.getByTestId('briefing');
		await expect(briefing).toContainText('AI is off');
		await expect(briefing.getByRole('link', { name: /settings/i })).toBeVisible();
		await expect(page.getByTestId('briefing-brief')).toHaveCount(0);
	});
});

test.describe('Today on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test.beforeEach(async ({ request }) => await resetVault(request));

	test('a segmented control switches between the timeline and the list', async ({ page }) => {
		await page.goto('/');
		const segment = page.getByTestId('today-segment');
		await expect(segment).toBeVisible();

		await expect(page.getByTestId('segment-timeline')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByTestId('unscheduled')).toBeHidden();

		await page.getByTestId('segment-list').tap();
		await expect(page.getByTestId('unscheduled')).toBeVisible();

		await page.reload();
		await expect(page.getByTestId('segment-list')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByTestId('unscheduled')).toBeVisible();
	});
});
