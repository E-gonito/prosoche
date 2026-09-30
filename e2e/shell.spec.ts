import { test, expect } from '@playwright/test';

test.describe('the shell', () => {
	test('the rail lists every module and the workspaces under Workspaces', async ({ page }) => {
		await page.goto('/notes');
		const rail = page.getByRole('navigation', { name: 'Modules' }).first();
		await expect(rail.locator('.modules > a')).toHaveText(['Today', 'Glossary', 'Flashcards', 'Workspaces', 'Study', 'Date', 'Notes']);
		// The fixture's Study subject is not a workspace: only Work sits under
		// Workspaces, and Study sits under Study.
		await expect(rail.getByTestId('sub-w').locator('a')).toHaveText(['Work']);
		await expect(rail.getByTestId('sub-study').locator('a')).toHaveText(['Study']);
		// The one glossary is Glossaries/Work.md, so it alone sits under Glossary.
		await expect(rail.getByTestId('sub-glossary').locator('a')).toHaveText(['Work']);
		await expect(rail.locator('.modules > a', { hasText: 'Notes' })).toHaveAttribute('aria-current', 'page');
	});

	test('a sub-item, not its module, is current on its own pages', async ({ page }) => {
		await page.goto('/glossary/work');
		const rail = page.getByRole('navigation', { name: 'Modules' }).first();
		await expect(rail.getByTestId('sub-glossary').getByRole('link', { name: 'Work' })).toHaveAttribute('aria-current', 'page');
		await expect(rail.locator('.modules > a', { hasText: 'Glossary' })).not.toHaveAttribute('aria-current', 'page');
		await page.goto('/w/work/log');
		await expect(rail.getByTestId('sub-w').getByRole('link', { name: 'Work' })).toHaveAttribute('aria-current', 'page');
		await expect(rail.getByTestId('sub-glossary').getByRole('link', { name: 'Work' })).not.toHaveAttribute('aria-current', 'page');
	});

	test('a phone gets a top bar of three modules, the review and a More sheet', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/notes');
		const bar = page.getByTestId('tabbar');
		await expect(bar).toBeVisible();
		await expect(bar.getByRole('link')).toHaveText(['Today', 'Review', 'Workspaces', 'Notes']);
		await bar.getByTestId('tab-more').click();
		await expect(page.locator('dialog.more')).toBeVisible();
		await expect(page.locator('dialog.more').getByRole('link', { name: 'Date', exact: true })).toBeVisible();
	});

	test('the palette opens from the keyboard', async ({ page }) => {
		await page.goto('/notes');
		await page.keyboard.press('Control+k');
		await expect(page.getByRole('dialog').getByRole('combobox').or(page.getByPlaceholder(/search|jump|type/i)).first()).toBeVisible();
	});
});
