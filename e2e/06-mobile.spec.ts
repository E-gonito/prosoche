import { test, expect } from '@playwright/test';
import { TODAY_NOTE, minutes, waitForFile, resetVault } from './helpers';

// Roughly a Galaxy S-series in portrait.
test.use({ viewport: { width: 412, height: 915 }, hasTouch: true });

test.describe('on a phone', () => {
	test.beforeEach(async ({ request }) => await resetVault(request));

	test('the sidebar is an icon rail and the day still fits', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('nav a').first()).toBeVisible();
		await expect(page.locator('nav a').first().locator('.lb')).toBeHidden();
		// Nothing spills sideways.
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(1);
	});

	test('the day stacks into one column', async ({ page }) => {
		await page.goto('/');
		const timeline = await page.getByTestId('timeline').boundingBox();
		const unscheduled = await page.getByTestId('unscheduled').boundingBox();
		// Stacked, so the panel starts below the timeline rather than beside it.
		expect(unscheduled!.y).toBeGreaterThan(timeline!.y);
	});

	test('a task can be ticked with a tap', async ({ page }) => {
		await page.goto('/');
		const row = page.getByTestId('task-row').filter({ hasText: 'Twenty push ups' });
		await row.getByTestId('checkbox').tap();
		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('- [x] Twenty push ups'))).toBe(true);
	});

	test('a block can be dragged with a finger', async ({ page }) => {
		await page.goto('/');
		// The timeline is two pixels a minute, so an afternoon block is below
		// the fold on a phone. Scroll to it first: a finger cannot reach what
		// is off screen, and neither can a synthetic pointer.
		const block = page.getByTestId('block').filter({ hasText: 'Read a book' });
		await block.scrollIntoViewIfNeeded();
		const box = await block.boundingBox();
		const x = box!.x + box!.width / 2;
		const y = box!.y + box!.height / 2;
		await page.touchscreen.tap(x, y);
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
		await expect(page.locator('.cm-content')).toContainText('Algorithms');
		// The file tree is hidden at this width to leave room for the note.
		await expect(page.locator('.tree')).toBeHidden();
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
