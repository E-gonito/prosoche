import { test, expect, type Page } from '@playwright/test';
import { TODAY_NOTE, resetVault, vaultFile, waitForFile } from './helpers';

/** Every character position where two versions of a file differ; they must be the same length. */
function changedChars(before: string, after: string): Array<[string, string]> {
	expect(after.length).toBe(before.length);
	return [...Array(after.length).keys()].filter((i) => before[i] !== after[i]).map((i) => [before[i], after[i]]);
}

const row = (page: Page, text: string) => page.getByTestId('review-row').filter({ hasText: text });

/** Press something on the review, wait for the note to change, and return what changed. */
async function act(page: Page, press: () => Promise<void>): Promise<Array<[string, string]>> {
	const before = vaultFile(TODAY_NOTE);
	await press();
	expect(await waitForFile(TODAY_NOTE, (c) => c !== before)).toBe(true);
	// Settled: the page has reloaded the line it will send with the next press.
	await expect(page.locator('[data-testid="review-row"][aria-busy="true"]')).toHaveCount(0);
	return changedChars(before, vaultFile(TODAY_NOTE));
}

test.beforeEach(async ({ request }) => await resetVault(request));

test.describe('Evening review', () => {
	test('lists the day timed first, and ticks, skips and un-skips one character at a time', async ({ page }) => {
		const original = vaultFile(TODAY_NOTE);
		await page.goto('/today/review');

		await expect(page.getByTestId('review-row')).toHaveText([
			/09:30.*Morning stretch/,
			/10:40.*Client project/,
			/14:00.*Read a book/,
			/23:00.*Write the daily log/,
			/Walk the dog/,
			/Twenty push ups/
		]);
		await expect(page.getByTestId('review-summary')).toHaveText(/^1 of 6 done/);

		expect(await act(page, () => row(page, 'Twenty push ups').getByTestId('review-tick').click())).toEqual([[' ', 'x']]);
		expect(await act(page, () => row(page, 'Walk the dog').getByTestId('review-skip').click())).toEqual([[' ', '-']]);
		expect(vaultFile(TODAY_NOTE)).toContain('\n- [-] Walk the dog, refill the water `Q1`\n');
		await expect(page.getByTestId('review-summary')).toHaveText(/^2 of 5 done · 1 skipped/);
		await expect(row(page, 'Walk the dog').getByTestId('review-skip')).toHaveAttribute('aria-pressed', 'true');

		// Un-skip: the same button again, back to open.
		expect(await act(page, () => row(page, 'Walk the dog').getByTestId('review-skip').click())).toEqual([['-', ' ']]);
		await expect(page.getByTestId('review-summary')).toHaveText(/^2 of 6 done/);

		// The keys on a focused row do the same: s skips, space reopens it.
		await row(page, 'Read a book').focus();
		expect(await act(page, () => page.keyboard.press('s'))).toEqual([[' ', '-']]);
		expect(await act(page, () => page.keyboard.press(' '))).toEqual([['-', 'x']]);
		expect(await act(page, () => page.keyboard.press(' '))).toEqual([['x', ' ']]);

		// Everything but the one ticked line is as it was.
		expect(changedChars(original, vaultFile(TODAY_NOTE))).toEqual([[' ', 'x']]);
	});

	test('ends with the inbox, linked to triage', async ({ page }) => {
		await page.goto('/today/review');
		const inbox = page.getByTestId('review-inbox').getByRole('link');
		await expect(inbox).toHaveText('4 in the inbox');
		await expect(inbox).toHaveAttribute('href', '/inbox');
	});

	test('has its own tab on a phone, and Today keeps the rail', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/today/review');
		const tabbar = page.getByTestId('tabbar');
		await expect(tabbar.getByRole('link', { name: 'Review' })).toHaveAttribute('aria-current', 'page');
		await expect(tabbar.getByRole('link', { name: 'Today' })).not.toHaveAttribute('aria-current', 'page');
		await tabbar.getByRole('link', { name: 'Today' }).click();
		await expect(page.getByTestId('today-title')).toBeVisible();
		await expect(tabbar.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
	});
});
