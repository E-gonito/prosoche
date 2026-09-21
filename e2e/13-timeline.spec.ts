import { test, expect } from '@playwright/test';
import { resetVault } from './helpers';

const DAY = '/day/2026-11-03';

/**
 * What a block may not do, whatever its height.
 *
 * A ten-minute block used to be drawn ten pixels tall, forced up to an
 * eighteen-pixel minimum, and then covered by the next one — so consecutive
 * short blocks sliced each other's text in half. The scale is now two pixels
 * a minute, which makes the height honest and removes the minimum entirely.
 * These tests are the arithmetic, checked in a real browser rather than
 * reasoned about.
 */
test.describe('the timeline at every block size', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto(DAY);
		await page.waitForSelector('[data-testid="block"]');
	});

	test('no block draws outside itself, at any width', async ({ page }) => {
		for (const width of [1400, 1100, 900, 430]) {
			await page.setViewportSize({ width, height: 900 });
			await page.waitForTimeout(200);
			const overflowing = await page.$$eval('[data-testid="block"]', (els) =>
				els
					.map((el) => ({
						text: el.textContent?.slice(0, 40) ?? '',
						overBy: el.scrollHeight - el.clientHeight
					}))
					// One pixel of rounding is not a defect; a clipped line is.
					.filter((r) => r.overBy > 1)
			);
			expect(overflowing, `at ${width}px`).toEqual([]);
		}
	});

	test('consecutive ten-minute blocks do not cover one another', async ({ page }) => {
		const boxes = [];
		for (const block of await page.getByTestId('block').all()) {
			const text = (await block.textContent()) ?? '';
			if (!text.includes('09:')) continue;
			boxes.push({ text, box: (await block.boundingBox())! });
		}
		expect(boxes.length).toBe(4);
		boxes.sort((a, b) => a.box.y - b.box.y);
		for (let i = 1; i < boxes.length; i++) {
			const above = boxes[i - 1].box;
			const below = boxes[i].box;
			expect(below.y, boxes[i].text).toBeGreaterThanOrEqual(above.y + above.height);
		}
	});

	test('every block is tall enough to read one line in', async ({ page }) => {
		for (const block of await page.getByTestId('block').all()) {
			const box = (await block.boundingBox())!;
			expect(box.height, (await block.textContent()) ?? '').toBeGreaterThanOrEqual(18);
		}
	});

	test('a name too long for its block is truncated, not sliced', async ({ page }) => {
		const long = page.getByTestId('block').filter({ hasText: '11:00' });
		await expect(long).toBeVisible();
		// The text is all there in the DOM; only the drawing is clipped, so a
		// screen reader and a copy-paste still get the whole task.
		await expect(long).toContainText('which is the whole point');
	});

	test('a nested block still sits beside the one containing it', async ({ page }) => {
		const outer = (await page.getByTestId('block').filter({ hasText: '13:00' }).boundingBox())!;
		const inner = (await page.getByTestId('block').filter({ hasText: '14:00' }).boundingBox())!;
		expect(inner.x).toBeGreaterThan(outer.x);
	});
});
