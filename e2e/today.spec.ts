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

	test('the clock on a workspace card plans it at a time as one new line, leaving Board.md alone', async ({ page }) => {
		const board = vaultFile('Work/Board.md');
		const note = vaultFile(TODAY_NOTE);
		const row = page.getByTestId('today-workspaces').getByTestId('board-card-row').filter({ hasText: 'Book the venue' });
		await row.getByTestId('schedule-card').click();
		const sheet = page.getByTestId('schedule-sheet');
		await sheet.getByTestId('schedule-start').fill('08:00');
		await sheet.getByTestId('schedule-save').click();

		await expect(page.getByTestId('block').filter({ hasText: 'Book the venue' })).toBeVisible();
		const after = vaultFile(TODAY_NOTE);
		expect(after.split('\n').length).toBe(note.split('\n').length + 1);
		expect(after).toContain('- [ ] 08:00 - 08:30 Book the venue [[Work/Board]] #ws/work');
		expect(vaultFile('Work/Board.md')).toBe(board);
	});

	test('a click on an empty time on the desktop offers the same choice', async ({ page }) => {
		const scroll = page.getByTestId('timeline-scroll');
		const box = (await scroll.boundingBox())!;
		await page.mouse.click(box.x + box.width - 20, box.y + 10);
		await expect(page.getByTestId('schedule-sheet')).toContainText('What goes at');
		await expect(page.getByTestId('schedule-choice').filter({ hasText: 'Twenty push ups' })).toBeVisible();
	});

	test('the Unscheduled box adds a task to the day’s note, not the inbox', async ({ page }) => {
		const inbox = vaultFile('Inbox/Capture.md');
		const capture = page.getByTestId('unscheduled').getByTestId('capture-row');
		await capture.getByLabel('Quick capture').fill('buy stamps');
		await capture.getByRole('button', { name: 'Add' }).click();
		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('\n- [ ] buy stamps\n'))).toBe(true);
		expect(vaultFile('Inbox/Capture.md')).toBe(inbox);
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

	test('has no week section; another day opens through Next day', async ({ page }) => {
		await expect(page.getByTestId('week-bars')).toHaveCount(0);
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

	test('has no briefing, and the inbox sits above the day', async ({ page }) => {
		await expect(page.getByTestId('briefing')).toHaveCount(0);
		const inbox = await page.getByTestId('today-inbox').boundingBox();
		const day = await page.getByTestId('unscheduled').boundingBox();
		expect(inbox!.y).toBeLessThan(day!.y);
	});
});

test.describe('Today on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

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

	/** The lines of the day's note that differ, by index. */
	const changed = (before: string, after: string) => {
		const a = before.split('\n');
		return after.split('\n').flatMap((line, i) => (line === a[i] ? [] : [i]));
	};

	test('a tap on an empty time offers the day’s tasks, and Schedule writes only that line', async ({ page }) => {
		const before = vaultFile(TODAY_NOTE);
		await page.goto('/');
		await page.getByTestId('timeline-scroll').scrollIntoViewIfNeeded();
		await expect(page.getByText('Tap a block to change its time. Tap an empty time to put a task there.')).toBeVisible();
		const box = (await page.getByTestId('timeline-scroll').boundingBox())!;
		await page.touchscreen.tap(box.x + box.width / 2, box.y + 20);

		const sheet = page.getByTestId('schedule-sheet');
		await expect(sheet).toContainText('What goes at');
		await sheet.getByTestId('schedule-choice').filter({ hasText: 'Twenty push ups' }).tap();
		await sheet.getByTestId('schedule-start').fill('07:00');
		await sheet.getByTestId('schedule-length').filter({ hasText: /^15m$/ }).tap();
		await expect(sheet.getByTestId('schedule-save')).toHaveText('Schedule 07:00–07:15');
		await sheet.getByTestId('schedule-save').tap();

		await expect(sheet).toHaveCount(0);
		await expect(page.getByTestId('block').filter({ hasText: 'Twenty push ups' })).toBeVisible();
		const after = vaultFile(TODAY_NOTE);
		expect(changed(before, after).map((i) => after.split('\n')[i])).toEqual(['- [ ] 07:00 - 07:15 Twenty push ups']);
	});

	test('a tap on a block opens its time, not a drag, and can move or unschedule it', async ({ page }) => {
		const before = vaultFile(TODAY_NOTE);
		await page.goto('/');
		const block = page.getByTestId('block').filter({ hasText: 'Read a book' });
		await block.scrollIntoViewIfNeeded();
		await block.tap();

		const sheet = page.getByTestId('schedule-sheet');
		await expect(sheet).toContainText('Change the time');
		await expect(sheet.getByTestId('schedule-start')).toHaveValue('14:00');
		await sheet.getByTestId('schedule-length').filter({ hasText: /^1h$/ }).tap();
		await sheet.getByTestId('schedule-save').tap();
		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('14:00 - 15:00 Read a book'))).toBe(true);
		expect(changed(before, vaultFile(TODAY_NOTE))).toHaveLength(1);

		await page.getByTestId('block').filter({ hasText: 'Read a book' }).tap();
		await page.getByTestId('schedule-unschedule').tap();
		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('- [ ] Read a book `Q2`'))).toBe(true);
		expect(changed(before, vaultFile(TODAY_NOTE))).toHaveLength(1);
	});

	test('the clock on an unscheduled task offers the first free time, and says what it did', async ({ page }) => {
		await page.goto('/');
		await page.getByTestId('segment-list').tap();
		const row = page.getByTestId('unscheduled').getByTestId('task-row').filter({ hasText: 'Walk the dog' });
		await row.getByTestId('schedule-task').tap();

		const sheet = page.getByTestId('schedule-sheet');
		await expect(sheet.getByTestId('schedule-task-name')).toHaveText('Walk the dog, refill the water');
		await sheet.getByTestId('schedule-start').fill('06:00');
		await sheet.getByTestId('schedule-save').tap();
		await expect(page.getByTestId('schedule-notice')).toHaveText('Walk the dog, refill the water: 06:00–06:30.');
		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('- [ ] 06:00 - 06:30 Walk the dog, refill the water `Q1`'))).toBe(true);
	});

	test('a finger on the timeline scrolls it rather than dragging a block', async ({ page }) => {
		const before = vaultFile(TODAY_NOTE);
		await page.goto('/');
		const block = page.getByTestId('block').filter({ hasText: 'Client project' });
		await block.scrollIntoViewIfNeeded();
		expect(await block.evaluate((el) => getComputedStyle(el).touchAction)).toBe('pan-y');
		await expect(page.getByTestId('resize').first()).toBeHidden();
		expect(vaultFile(TODAY_NOTE)).toBe(before);
	});
});
