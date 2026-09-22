import { test, expect } from '@playwright/test';
import { resetVault } from './helpers';

// The editor, explicitly: these tests resize the panes around it, and a note
// opens to read unless the URL says otherwise.
const NOTE = '/notes/Study/Algorithms.md?edit=1';

test.describe('the notes panes', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto(NOTE);
	});

	test('all three panes are visible by default', async ({ page }) => {
		await expect(page.locator('.tree')).toBeVisible();
		await expect(page.locator('.note-pane')).toBeVisible();
		await expect(page.locator('.rail')).toBeVisible();
	});

	test('the file tree collapses to a tab and comes back', async ({ page }) => {
		const editorBefore = (await page.locator('.note-pane').boundingBox())!.width;
		await page.getByRole('button', { name: 'Hide the file tree' }).click();

		await expect(page.locator('.tree')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Show the file tree' })).toBeVisible();
		// The editor takes the freed space.
		expect((await page.locator('.note-pane').boundingBox())!.width).toBeGreaterThan(editorBefore);

		await page.getByRole('button', { name: 'Show the file tree' }).click();
		await expect(page.locator('.tree')).toBeVisible();
	});

	test('the links panel collapses independently', async ({ page }) => {
		await page.getByRole('button', { name: "Hide the note's details" }).click();
		await expect(page.locator('.rail')).toHaveCount(0);
		await expect(page.locator('.tree')).toBeVisible();
		await page.getByRole('button', { name: "Show the note's details" }).click();
		await expect(page.locator('.rail')).toBeVisible();
	});

	test('a collapsed pane stays collapsed across a reload and a navigation', async ({ page }) => {
		await page.getByRole('button', { name: 'Hide the file tree' }).click();
		await page.reload();
		await expect(page.getByRole('button', { name: 'Show the file tree' })).toBeVisible();
		await page.goto('/notes/Work/Handbook.md');
		await expect(page.getByRole('button', { name: 'Show the file tree' })).toBeVisible();
	});

	test('dragging the divider resizes the tree, and the width is remembered', async ({ page }) => {
		const before = (await page.locator('.tree').boundingBox())!.width;
		const handle = page.getByRole('separator', { name: 'Resize the file tree' });
		const box = (await handle.boundingBox())!;

		await page.mouse.move(box.x + box.width / 2, box.y + 100);
		await page.mouse.down();
		for (let i = 1; i <= 6; i++) {
			await page.mouse.move(box.x + box.width / 2 + (120 * i) / 6, box.y + 100);
			await page.waitForTimeout(12);
		}
		await page.mouse.up();

		const after = (await page.locator('.tree').boundingBox())!.width;
		expect(after).toBeGreaterThan(before + 80);

		await page.reload();
		const restored = (await page.locator('.tree').boundingBox())!.width;
		expect(Math.abs(restored - after)).toBeLessThan(4);
	});

	test('dragging the divider far inwards collapses the pane', async ({ page }) => {
		const handle = page.getByRole('separator', { name: 'Resize the file tree' });
		const box = (await handle.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + 100);
		await page.mouse.down();
		for (let i = 1; i <= 8; i++) {
			await page.mouse.move(Math.max(2, box.x - (box.x * i) / 8), box.y + 100);
			await page.waitForTimeout(12);
		}
		await page.mouse.up();
		await expect(page.getByRole('button', { name: 'Show the file tree' })).toBeVisible();
	});

	test('the divider cannot be dragged wide enough to squeeze out the editor', async ({ page }) => {
		const handle = page.getByRole('separator', { name: 'Resize the file tree' });
		const box = (await handle.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + 100);
		await page.mouse.down();
		await page.mouse.move(2000, box.y + 100);
		await page.mouse.up();

		const editor = (await page.locator('.note-pane').boundingBox())!;
		expect(editor.width).toBeGreaterThan(200);
		const tree = (await page.locator('.tree').boundingBox())!;
		expect(tree.width).toBeLessThanOrEqual(520);
	});

	test('the divider resizes with the keyboard', async ({ page }) => {
		const before = (await page.locator('.tree').boundingBox())!.width;
		const handle = page.getByRole('separator', { name: 'Resize the file tree' });
		await handle.focus();
		for (let i = 0; i < 4; i++) await handle.press('ArrowRight');
		expect((await page.locator('.tree').boundingBox())!.width).toBeGreaterThan(before);
		for (let i = 0; i < 8; i++) await handle.press('ArrowLeft');
		expect((await page.locator('.tree').boundingBox())!.width).toBeLessThan(before);
	});

	test('the divider reports its size to assistive technology', async ({ page }) => {
		const handle = page.getByRole('separator', { name: 'Resize the file tree' });
		await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
		await expect(handle).toHaveAttribute('aria-valuemin', '160');
		await expect(handle).toHaveAttribute('aria-valuemax', '520');
		expect(Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(100);
	});

	test('double-clicking a divider collapses and restores its pane', async ({ page }) => {
		await page.getByRole('separator', { name: 'Resize the file tree' }).dblclick();
		await expect(page.getByRole('button', { name: 'Show the file tree' })).toBeVisible();
	});

	test('the editor still works after the panes are rearranged', async ({ page }) => {
		await page.getByRole('button', { name: 'Hide the file tree' }).click();
		await page.getByRole('button', { name: "Hide the note's details" }).click();
		await expect(page.locator('.cm-content')).toContainText('Algorithms');
		// Clicking the heading itself, so the cursor lands on that line.
		await page.locator('.cm-line.cm-h1').click();
		await expect(page.locator('.cm-line.cm-h1')).toContainText('# Algorithms');
	});
});

test.describe('the notes panes on a phone', () => {
	test.use({ viewport: { width: 412, height: 915 } });

	test('stack into one column with no dividers', async ({ page, request }) => {
		await resetVault(request);
		await page.goto(NOTE);
		await expect(page.locator('.note-pane')).toBeVisible();
		await expect(page.locator('.tree')).toBeHidden();
		await expect(page.getByRole('separator')).toHaveCount(0);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(1);
	});
});
