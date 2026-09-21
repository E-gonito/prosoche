import { test, expect } from '@playwright/test';

test.describe('the shell', () => {
	test('the root redirects to today and renders the day', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/day\/\d{4}-\d{2}-\d{2}$/);
		await expect(page.locator('main .head h1')).toContainText(new Date().getFullYear().toString());
	});

	test('every nav destination loads', async ({ page }) => {
		for (const [label, pattern] of [
			['Notes', /\/notes$/],
			['Search', /\/search$/],
			['Sync', /\/sync$/],
			['Today', /\/day\//]
		] as const) {
			await page.goto('/');
			await page.locator('nav.sidebar').getByRole('link', { name: label, exact: false }).click();
			await expect(page).toHaveURL(pattern);
			await expect(page.locator('main h1').first()).toBeVisible();
		}
	});

	test('the sidebar collapses and the choice survives a reload', async ({ page }) => {
		await page.goto('/');
		const label = page.locator('nav.sidebar a').first().locator('.lb');
		await expect(label).toBeVisible();
		await page.getByRole('button', { name: /Collapse sidebar/ }).click();
		await expect(label).toBeHidden();
		await page.reload();
		await expect(page.locator('nav.sidebar a').first().locator('.lb')).toBeHidden();
		// Put it back, so later tests see the default.
		await page.getByRole('button', { name: /Expand sidebar/ }).click();
		await expect(page.locator('nav.sidebar a').first().locator('.lb')).toBeVisible();
	});

	test('settings is in the sidebar, at the bottom, and goes to the AI page', async ({ page }) => {
		await page.goto('/');
		const settings = page.locator('nav.sidebar').getByRole('link', { name: 'Settings' });
		await expect(settings).toBeVisible();
		// Below every other destination, which is the whole point of pinning it.
		const links = page.locator('nav.sidebar a');
		const last = links.nth((await links.count()) - 1);
		await expect(last).toHaveAttribute('href', '/settings/ai');
		await settings.click();
		await expect(page).toHaveURL(/\/settings\/ai$/);
		await expect(page.locator('main .head h1')).toContainText('AI');
	});

	test('the header offers the palette to anyone who does not know the chord', async ({ page }) => {
		await page.goto('/');
		const jump = page.getByTestId('jump');
		await expect(jump).toContainText('Search or jump to');
		// The binding is shown, so pressing it once is enough to learn it.
		await expect(jump.locator('kbd')).toContainText('K');
		await jump.click();
		await expect(page.getByTestId('palette')).toBeVisible();
		await expect(page.getByTestId('palette-input')).toBeFocused();
	});

	test('the health endpoint reports a working index', async ({ request }) => {
		const body = await (await request.get('/api/health')).json();
		expect(body.ok).toBe(true);
		expect(body.notes).toBeGreaterThan(3);
		expect(body.parseProblems).toBe(0);
	});

	test('a bad date is a 404, and so is a path outside the vault', async ({ request }) => {
		expect((await request.get('/day/not-a-date')).status()).toBe(404);
		expect((await request.get('/day/2026-02-30')).status()).toBe(404);
		expect((await request.get('/notes/../../etc/passwd')).status()).toBe(404);
	});
});
