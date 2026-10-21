import { test, expect } from '@playwright/test';

test.describe('the shell', () => {
	test('the rail lists every module and the workspaces under Workspaces', async ({ page }) => {
		await page.goto('/notes');
		const rail = page.getByRole('navigation', { name: 'Modules' }).first();
		await expect(rail.locator('.modules > .row > a')).toHaveText(['Today', 'Glossary', 'Flashcards', 'Workspaces', 'Study', 'Graph', 'Cute', 'Date', 'Notes', 'Tactics']);
		// The fixture's Study subject is not a workspace: only Work sits under
		// Workspaces, and Study sits under Study.
		await expect(rail.getByTestId('sub-w').locator('a')).toHaveText(['Work']);
		await expect(rail.getByTestId('sub-study').locator('a')).toHaveText(['Study']);
		// The one glossary is Glossaries/Work.md, so it alone sits under Glossary.
		await expect(rail.getByTestId('sub-glossary').locator('a')).toHaveText(['Work']);
		await expect(rail.locator('.modules > .row > a', { hasText: 'Notes' })).toHaveAttribute('aria-current', 'page');
	});

	test('a group folds behind its chevron, and stays folded on this device', async ({ page }) => {
		await page.goto('/w/work/log');
		const rail = page.getByRole('navigation', { name: 'Modules' }).first();
		await expect(rail.getByTestId('sub-w')).toBeVisible();
		await rail.getByTestId('fold-w').click();
		await expect(rail.getByTestId('sub-w')).toHaveCount(0);
		await expect(rail.getByTestId('fold-w')).toHaveAttribute('aria-expanded', 'false');
		// Folded, the module stands in for the workspace you are on.
		await expect(rail.locator('.modules > .row > a', { hasText: 'Workspaces' })).toHaveAttribute('aria-current', 'page');
		// The other groups are untouched.
		await expect(rail.getByTestId('sub-glossary')).toBeVisible();
		await page.reload();
		await expect(rail.getByTestId('sub-w')).toHaveCount(0);
		await rail.getByTestId('fold-w').click();
		await expect(rail.getByTestId('sub-w').locator('a')).toHaveText(['Work']);
	});

	test('a sub-item, not its module, is current on its own pages', async ({ page }) => {
		await page.goto('/glossary/work');
		const rail = page.getByRole('navigation', { name: 'Modules' }).first();
		await expect(rail.getByTestId('sub-glossary').getByRole('link', { name: 'Work' })).toHaveAttribute('aria-current', 'page');
		await expect(rail.locator('.modules > .row > a', { hasText: 'Glossary' })).not.toHaveAttribute('aria-current', 'page');
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

	test('the moon turns the lights off, and the choice outlives a reload', async ({ page }) => {
		await page.goto('/notes');
		const html = page.locator('html');
		await expect(html).toHaveAttribute('data-theme', 'light');
		const button = page.getByRole('navigation', { name: 'Modules' }).first().getByTestId('theme');
		await expect(button).toHaveAttribute('aria-pressed', 'false');

		await button.click();
		await expect(html).toHaveAttribute('data-theme', 'dark');
		await expect(button).toHaveAttribute('aria-pressed', 'true');
		const paper = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		expect(paper).toBe('rgb(27, 25, 22)');

		// The head script applies it before the app runs, so nothing flashes.
		await page.reload();
		await expect(html).toHaveAttribute('data-theme', 'dark');

		await page.getByRole('navigation', { name: 'Modules' }).first().getByTestId('theme').click();
		await expect(html).toHaveAttribute('data-theme', 'light');
	});

	test('until the button is pressed, a dark device gets the dark theme', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.goto('/notes');
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	});
});
