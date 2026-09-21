import { test, expect } from '@playwright/test';
import { resetVault } from './helpers';

test.describe('search', () => {
	test.beforeEach(async ({ request }) => await resetVault(request));

	test('finds a note by body text and highlights the match', async ({ page }) => {
		await page.goto('/search');
		await page.getByLabel('Search notes').fill('complement');
		await page.getByRole('button', { name: 'Search' }).click();
		// Not a count: another fixture may legitimately use the same word, and a
		// test that breaks when it does is testing the fixture, not the search.
		const handbook = page.locator('.hit').filter({ hasText: 'Handbook' });
		await expect(handbook).toHaveCount(1);
		await expect(handbook.locator('mark')).toContainText('complement');
		// It matched on the body, not on everything: a note without the word is
		// not in the results.
		await expect(page.locator('.hit').filter({ hasText: 'Journal Template' })).toHaveCount(0);
	});

	test('matches a prefix, as a search box should', async ({ page }) => {
		await page.goto('/search?q=algo');
		await expect(page.locator('.hit b').first()).toContainText('Algorithms');
	});

	test('a hit opens the note', async ({ page }) => {
		await page.goto('/search?q=complement');
		await page.locator('.hit').first().click();
		await expect(page).toHaveURL(/Handbook\.md$/);
	});

	test('says so when nothing matches, rather than looking broken', async ({ page }) => {
		await page.goto('/search?q=zzzznothinghere');
		await expect(page.getByText('Nothing matched')).toBeVisible();
	});

	test('an empty query invites one instead of erroring', async ({ page }) => {
		await page.goto('/search');
		await expect(page.getByText('Type something to search')).toBeVisible();
	});

	test('a query full of operators does not break the page', async ({ page }) => {
		await page.goto('/search?q=%22%22%22*%28');
		await expect(page.getByText(/results? for/)).toBeVisible();
	});
});
