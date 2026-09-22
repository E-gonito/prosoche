import { test, expect } from '@playwright/test';
import { TODAY_NOTE, centreBlock, minutes, waitForFile, resetVault } from './helpers';

// Roughly a Galaxy S-series in portrait.
test.use({ viewport: { width: 412, height: 915 }, hasTouch: true });

test.describe('on a phone', () => {
	test.beforeEach(async ({ request }) => await resetVault(request));

	/*
	 * The sidebar used to narrow to an icon rail here. It is gone instead: a
	 * column of unlabelled icons cost width a phone does not have and put every
	 * target under the thumb's reach. The bar at the bottom replaces it.
	 */
	test('the sidebar is gone and a bottom bar takes its place', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('nav.sidebar')).toBeHidden();

		const bar = page.getByTestId('tabbar');
		await expect(bar).toBeVisible();
		const items = bar.locator('a, button');
		await expect(items).toHaveCount(5);
		await expect(items).toHaveText([/Today/, /Study/, /Notes/, /Search/, /More/]);

		// Where you are is marked, and the root is Today however it redirects.
		await expect(bar.locator('[aria-current="page"]')).toHaveText(/Today/);

		// Every target is big enough to hit without aiming.
		for (let i = 0; i < 5; i++) {
			const box = await items.nth(i).boundingBox();
			expect(box!.height).toBeGreaterThanOrEqual(44);
		}

		// Nothing spills sideways.
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(1);
	});

	test('More opens the palette, which is where the workspaces are', async ({ page }) => {
		await page.goto('/');
		await page.getByTestId('tab-more').tap();
		await expect(page.getByTestId('palette')).toBeVisible();
		await page.keyboard.type('polish');
		await expect(page.getByTestId('palette-row').first()).toBeVisible();
	});

	test('the bar never covers the bottom of the page', async ({ page }) => {
		await page.goto('/');
		const reserved = await page.evaluate(() => {
			const main = document.querySelector('main')!;
			return parseFloat(getComputedStyle(main).paddingBottom);
		});
		const bar = (await page.getByTestId('tabbar').boundingBox())!;
		expect(reserved).toBeGreaterThanOrEqual(bar.height);
	});

	/*
	 * Stacking the two columns made the day a two-thousand pixel scroll, with
	 * the half you wanted always below the half you did not. One at a time
	 * instead, chosen at the top and remembered.
	 */
	test('the day is one column at a time, and remembers which', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByTestId('day-segment')).toBeVisible();
		await expect(page.getByTestId('timeline')).toBeVisible();
		await expect(page.getByTestId('unscheduled')).toBeHidden();

		await page.getByTestId('segment-tasks').tap();
		await expect(page.getByTestId('unscheduled')).toBeVisible();
		await expect(page.getByTestId('timeline')).toBeHidden();

		await page.reload();
		await expect(page.getByTestId('unscheduled')).toBeVisible();

		// Back to the default, so the tests after this one see it.
		await page.getByTestId('segment-timeline').tap();
		await expect(page.getByTestId('timeline')).toBeVisible();
	});

	test('a task can be ticked with a tap', async ({ page }) => {
		await page.goto('/');
		// The tasks live in the other segment; the timeline is what opens.
		await page.getByTestId('segment-tasks').tap();
		const row = page.getByTestId('task-row').filter({ hasText: 'Twenty push ups' });
		await row.getByTestId('checkbox').tap();
		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('- [x] Twenty push ups'))).toBe(true);
	});

	test('a block can be dragged with a finger', async ({ page }) => {
		await page.goto('/');
		// The timeline is two pixels a minute inside a card the height of the
		// screen, so an afternoon block is off the window it scrolls in. Bring
		// it to the middle first: a finger cannot reach what is not on screen,
		// and neither can a synthetic pointer.
		const { x, y } = await centreBlock(page, 'Read a book');
		// Straight into the gesture, with no tap first: a press that goes
		// nowhere is how a block is opened for editing, and the card it opens
		// would swallow the drag.
		// Playwright's touchscreen has no drag, so use pointer events, which is
		// what the component listens for either way.
		await page.mouse.move(x, y);
		await page.mouse.down();
		// Forty minutes later, said in minutes so the timeline's scale can change
		// without silently turning this into a different gesture.
		const by = minutes(40);
		for (let i = 1; i <= 6; i++) {
			await page.mouse.move(x, y + (by * i) / 6);
			await page.waitForTimeout(12);
		}
		await page.mouse.up();
		expect(await waitForFile(TODAY_NOTE, (c) => /14:40 - 15:10 Read a book/.test(c))).toBe(true);
	});

	test('a note is readable and editable', async ({ page }) => {
		await page.goto('/notes/Study/Algorithms.md');
		// Reading first, which is what a phone is mostly for.
		await expect(page.locator('.prose')).toContainText('Algorithms');
		// The file tree is hidden at this width; the Files button raises it.
		await expect(page.locator('.tree')).toBeHidden();
		await expect(page.getByTestId('open-files')).toBeVisible();

		await page.goto('/notes/Study/Algorithms.md?edit=1');
		await expect(page.locator('.cm-content')).toContainText('Algorithms');
	});

	test('search works', async ({ page }) => {
		await page.goto('/search?q=complement');
		// The note, not the only note: more than one may use the word, and a
		// test that breaks when one does is testing the fixture.
		await expect(page.locator('.hit').filter({ hasText: 'Work/Handbook.md' })).toHaveCount(1);
	});

	test('the sync page does not overflow', async ({ page }) => {
		await page.goto('/sync');
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(1);
	});
});
