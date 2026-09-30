import { test, expect } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resetVault, TODAY, VAULT, vaultFile, waitForFile } from './helpers';
import decks from './flashcards-vault.mjs';

/**
 * Flashcards, against `flashcards-vault.mjs`: the Networks deck (one card
 * overdue, two new, in two categories) and the Tagalog deck (twenty new),
 * sharing fifteen new cards a day.
 */

const PROTOCOLS = 'Flashcards/Networks/Protocols (cards).md';

test.describe('Flashcards', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		// Today's count of first reviews is transient state a reset leaves behind.
		rmSync(join(VAULT, '_hub/.state/new-cards.json'), { force: true });
		for (const [path, content] of Object.entries(decks({ TODAY }) as Record<string, string>)) {
			mkdirSync(dirname(join(VAULT, path)), { recursive: true });
			writeFileSync(join(VAULT, path), content);
		}
		// The page reads the vault once the watcher has seen the new files.
		await expect(async () => {
			await page.goto('/flashcards');
			await expect(page.getByTestId('due-count')).toHaveText('16', { timeout: 1000 });
		}).toPass();
	});

	test('shares fifteen new cards a day between the decks, and shows each deck’s categories', async ({ page }) => {
		// TCP is due; Networks' two new cards and thirteen of Tagalog's make fifteen.
		await expect(page.getByTestId('due-count')).toHaveText('16');
		const networks = page.getByTestId('deck').filter({ hasText: 'Networks' });
		await expect(networks).toContainText('1 due · 2 new · 3 cards');
		await expect(networks.getByTestId('deck-categories').getByRole('link')).toHaveText([/Naming\s*1/, /Protocols\s*2/]);
		await expect(page.getByTestId('deck').filter({ hasText: 'Tagalog' })).toContainText('0 due · 13 new · 20 cards');
	});

	test('the number a day is saved to _hub/flashcards.md and shared out again', async ({ page }) => {
		await page.getByTestId('per-day').fill('3');
		await page.getByTestId('new-per-day').getByRole('button', { name: 'Save' }).click();
		expect(await waitForFile('_hub/flashcards.md', (c) => c.includes('new_per_day: 3'))).toBe(true);
		await expect(page.getByTestId('due-count')).toHaveText('4');
	});

	test('a category’s review grades its card and rewrites the legacy comment as FSRS state', async ({ page }) => {
		const before = vaultFile(PROTOCOLS);
		await page.getByTestId('deck').filter({ hasText: 'Networks' }).getByRole('link', { name: /^Protocols/ }).click();
		await expect(page).toHaveURL('/flashcards/review?deck=networks&category=Protocols');
		await expect(page.getByTestId('card-question')).toContainText('TCP');
		await page.getByTestId('card').click();
		await expect(page.getByTestId('card-answer')).toContainText('A reliable transport.');
		await page.getByTestId('grade-good').click();

		// The fixture's `<!--SR:…-->` line, and only it, becomes prosoche's own comment.
		const fsrs = new RegExp(`<!--fsrs:(\\d{4}-\\d{2}-\\d{2}),[\\d.]+,[\\d.]+,2,0,review,${TODAY}(?:!new)?-->`);
		expect(await waitForFile(PROTOCOLS, (c) => fsrs.test(c))).toBe(true);
		expect(vaultFile(PROTOCOLS).replace(fsrs, 'COMMENT')).toBe(before.replace(/<!--SR:[^\n]*-->/, 'COMMENT'));
		// The generated Anki deck beside it is not the app's to touch.
		expect(vaultFile('Flashcards/Networks/Old deck.txt')).toBe('front\tback\n');
	});

	test('Review all takes the decks in turn', async ({ page }) => {
		await page.getByTestId('review-all').click();
		await expect(page).toHaveURL('/flashcards/review');
		await expect(page.getByTestId('card-question')).toContainText('TCP');
	});

	test('Today has one line for every deck, leading to the review of them all', async ({ page }) => {
		await page.goto('/today');
		const line = page.getByRole('link', { name: /16 cards to review/ });
		await expect(line).toHaveAttribute('href', '/flashcards/review');
	});

	test('the old Study addresses lead here', async ({ page }) => {
		await page.goto('/study/flashcards');
		await expect(page).toHaveURL('/flashcards');
	});

	test('on a phone, the review session fits', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/flashcards/review');
		await page.getByTestId('card').click();
		const grades = page.getByTestId('grades');
		await expect(grades).toBeVisible();
		const box = await grades.boundingBox();
		expect(box!.width).toBeLessThanOrEqual(390);
		expect(box!.width / 4).toBeGreaterThan(44);
	});
});
