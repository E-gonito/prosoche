import { test, expect } from '@playwright/test';
import { centreBlock, lineWith, resetVault, vaultFile, waitForFile } from './helpers';

/**
 * The shape of the Today page, as against what it says.
 *
 * Phase 2 of the interface work turned the day into a timeline in a window
 * the height of the screen, a briefing that folds, capture inside the list it
 * feeds, and — on a phone — one column at a time. Each of those is a claim
 * about pixels or about what survives a reload, which is what this file is
 * for: the tests that can only be made in a browser.
 */

/** A day with nothing but blocks on it, so the arithmetic is the same every run. */
const FIXED_DAY = '/day/2026-11-03';
const FIXED_NOTE = 'Journal/2026/11/03.md';

/** What the window onto the grid is showing, in pixels and in minutes. */
async function viewOf(page: import('@playwright/test').Page) {
	return await page.evaluate(() => {
		const view = document.querySelector('[data-testid="timeline-scroll"]') as HTMLElement;
		const block = document.querySelector('[data-testid="block"]') as HTMLElement | null;
		// A block carries the minute it starts at and the pixel it starts at,
		// which is the whole of the conversion between the two.
		const minuteAt = (px: number) =>
			block ? Number(block.dataset.start) + (px - block.offsetTop) / 2 : 0;
		return {
			scrollTop: view.scrollTop,
			fromMinute: minuteAt(0),
			clientHeight: view.clientHeight,
			scrollHeight: view.scrollHeight,
			firstBlockTop: block?.offsetTop ?? 0,
			topMinute: minuteAt(view.scrollTop),
			bottomMinute: minuteAt(view.scrollTop + view.clientHeight)
		};
	});
}

test.describe('the day, as a shape', () => {
	test.beforeEach(async ({ request }) => await resetVault(request));

	test('the grid scrolls inside the card rather than the page scrolling past it', async ({ page }) => {
		await page.goto(FIXED_DAY);
		await page.waitForSelector('[data-testid="block"]');

		const view = await viewOf(page);
		// There is more day than window: that is the situation this exists for.
		expect(view.scrollHeight).toBeGreaterThan(view.clientHeight);
		// And the card ends inside the window rather than running off the bottom.
		const box = (await page.getByTestId('timeline-scroll').boundingBox())!;
		expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
	});

	test('a day that is not today opens just above its first block', async ({ page }) => {
		await page.goto(FIXED_DAY);
		await page.waitForSelector('[data-testid="block"]');

		// 09:00 is the earliest block, ten minutes of headroom above it.
		const view = await viewOf(page);
		expect(view.scrollTop).toBe(view.firstBlockTop - 20);
		expect(view.topMinute).toBe(530);
	});

	test('today opens at the hour before now', async ({ page }) => {
		await page.goto('/');
		await page.waitForSelector('[data-testid="block"]');

		const view = await viewOf(page);
		const nowMin = await page.evaluate(() => new Date().getHours() * 60 + new Date().getMinutes());
		// The hour before now is at the top, unless the grid has run out of
		// content to scroll, and in the small hours nothing above it either.
		const atEnd = view.scrollTop >= view.scrollHeight - view.clientHeight - 1;
		const wanted = Math.max(view.fromMinute, Math.floor(nowMin / 60) * 60 - 60);
		if (!atEnd) expect(view.topMinute).toBe(wanted);
		// Either way, now is on screen, which is the point of the rule.
		if (nowMin >= 360) {
			expect(nowMin).toBeGreaterThanOrEqual(view.topMinute - 1);
			expect(nowMin).toBeLessThanOrEqual(view.bottomMinute + 1);
		}
	});

	test('a block can be dragged to a time the window was not showing', async ({ page }) => {
		// A short window, so there is plenty of day off the bottom of it.
		await page.setViewportSize({ width: 1100, height: 700 });
		await page.goto(FIXED_DAY);
		await page.waitForSelector('[data-testid="block"]');

		const before = await viewOf(page);
		const from = await centreBlock(page, 'Ten minutes flat');
		const view = (await page.getByTestId('timeline-scroll').boundingBox())!;

		// Drag to the bottom edge and hold there. Holding is the gesture: the
		// window scrolls on a frame timer, not on movement, because a pointer
		// pressed against the edge is not moving.
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		for (let i = 1; i <= 6; i++) {
			await page.mouse.move(from.x, from.y + ((view.y + view.height - 8 - from.y) * i) / 6);
			await page.waitForTimeout(12);
		}
		await page.waitForTimeout(900);
		await page.mouse.up();

		expect(await waitForFile(FIXED_NOTE, (c) => !c.includes('09:00 - 09:10 Ten minutes flat'))).toBe(true);
		const { text } = lineWith(FIXED_NOTE, 'Ten minutes flat');
		const [, hh, mm] = /(\d\d):(\d\d) - \d\d:\d\d Ten minutes flat/.exec(text)!;
		// Later than anything the window could show before the drag started.
		expect(Number(hh) * 60 + Number(mm)).toBeGreaterThan(before.bottomMinute);
		// Ten minutes long still: a move is a move.
		expect(text).toMatch(/^- \[ \] \d\d:\d0 - \d\d:\d0 Ten minutes flat `Q1`$/);
	});

	test('the briefing folds away and stays folded', async ({ page }) => {
		await page.goto('/');
		const strip = page.getByTestId('briefing');
		await expect(strip).toContainText('No briefing yet today');

		await page.getByTestId('briefing-fold').click();
		await expect(strip).not.toContainText('No briefing yet today');
		// Folded, not gone: the button that fills it in is still there.
		await expect(page.getByTestId('briefing-regenerate')).toBeVisible();

		await page.reload();
		await expect(page.getByTestId('briefing')).not.toContainText('No briefing yet today');

		// And it comes back.
		await page.getByTestId('briefing-fold').click();
		await expect(page.getByTestId('briefing')).toContainText('No briefing yet today');
	});

	test('capture is the first row of the unscheduled list, and writes to the inbox', async ({ page }) => {
		await page.goto('/');
		const card = page.getByTestId('unscheduled');
		const row = card.getByTestId('capture-row');
		await expect(row).toBeVisible();

		// Above the tasks, because it is how a task gets into a list.
		const rowBox = (await row.boundingBox())!;
		const firstTask = (await card.getByTestId('task-row').first().boundingBox())!;
		expect(rowBox.y).toBeLessThan(firstTask.y);

		const before = vaultFile('Inbox/Capture.md');
		await row.getByLabel('Quick capture').fill('buy stamps');
		await row.getByRole('button', { name: 'Add' }).click();

		expect(await waitForFile('Inbox/Capture.md', (c) => c.includes('buy stamps'))).toBe(true);
		expect(vaultFile('Inbox/Capture.md')).toMatch(/## \d{4}-\d{2}-\d{2}\n- \d\d:\d\d buy stamps/);
		// Everything that was already there is still there, byte for byte.
		expect(vaultFile('Inbox/Capture.md').startsWith(before)).toBe(true);
		// It says where it went.
		await expect(card).toContainText('Inbox/Capture.md');
	});
});

test.describe('the day on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test.beforeEach(async ({ request }) => await resetVault(request));

	test('the segmented control switches columns, and the choice survives a reload', async ({ page }) => {
		await page.goto('/');
		const segment = page.getByTestId('day-segment');
		await expect(segment).toBeVisible();

		// Timeline is what a day opens on.
		await expect(page.getByTestId('segment-timeline')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByTestId('timeline')).toBeVisible();
		await expect(page.getByTestId('unscheduled')).toBeHidden();

		await page.getByTestId('segment-tasks').tap();
		await expect(page.getByTestId('unscheduled')).toBeVisible();
		await expect(page.getByTestId('timeline')).toBeHidden();

		await page.reload();
		await expect(page.getByTestId('segment-tasks')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByTestId('unscheduled')).toBeVisible();
	});

	test('the timeline fills the space between the header and the bottom bar', async ({ page }) => {
		await page.goto('/');
		await page.waitForSelector('[data-testid="block"]');

		const card = (await page.locator('.day-timeline').boundingBox())!;
		const view = (await page.getByTestId('timeline-scroll').boundingBox())!;
		const bar = (await page.getByTestId('tabbar').boundingBox())!;

		// The card stops above the bar rather than behind it, and it takes
		// what is there: no stripe of wasted screen between the two.
		expect(card.y + card.height).toBeLessThanOrEqual(bar.y);
		expect(bar.y - (card.y + card.height)).toBeLessThan(60);
		// Most of the card is grid rather than heading and hint.
		expect(view.height).toBeGreaterThan((bar.y - view.y) * 0.6);
	});
});
