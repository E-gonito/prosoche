import { test, expect } from '@playwright/test';
import { vaultFile } from './helpers';

test.describe('Notes', () => {
	test('searches the vault and opens a note read-only', async ({ page }) => {
		await page.goto('/notes');
		await page.getByTestId('notes-search').fill('complement');
		const results = page.getByTestId('search-results');
		await expect(results.getByText('Handbook').first()).toBeVisible();
		await results.getByRole('link').first().click();
		await expect(page.getByTestId('note-body')).toContainText('Twos complement');
		await expect(page.getByRole('textbox', { name: /edit/i })).toHaveCount(0);
	});

	test('shows what links to a note', async ({ page }) => {
		await page.goto('/notes/Work/Handbook.md');
		await expect(page.getByRole('link', { name: 'Algorithms' })).toBeVisible();
	});

	test('captures a line into the inbox', async ({ page }) => {
		await page.goto('/notes');
		await page.getByLabel('Quick capture').fill('Call the dentist');
		await page.getByRole('button', { name: 'Add' }).click();
		await expect(page.getByText('Saved to Inbox/Capture.md')).toBeVisible();
		expect(vaultFile('Inbox/Capture.md')).toContain('Call the dentist');
	});

	test('never shows the private folder', async ({ page }) => {
		await page.goto('/notes');
		await expect(page.getByText('Private', { exact: true })).toHaveCount(0);
		const response = await page.goto('/notes/Private/Dating/Ledger.md');
		expect(response?.status()).toBe(404);
		await page.goto('/notes');
		await page.getByTestId('notes-search').fill('matches');
		await expect(page.getByTestId('search-results')).toContainText('Nothing matches');
	});
});
