import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resetVault, VAULT, vaultFile } from './helpers';

const NETWORKING = 'Study/Flashcards/CS/Networking (cards).md';
const WISDOM = 'Study/Flashcards/Wisdom (cards).md';

test.describe('Anki import', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('is reached from the Flashcards tab', async ({ page }) => {
		await page.goto('/study/study/flashcards');
		await page.getByTestId('anki-import-link').click();
		await expect(page).toHaveURL(/\/study\/study\/import$/);
	});

	test('previews every deck without writing anything', async ({ page }) => {
		await page.goto('/study/study/import');
		const decks = page.getByTestId('anki-deck');
		await expect(decks).toHaveCount(2);
		await expect(page.getByTestId('anki-plan')).toContainText('2 decks, 3 cards. 2 to create');
		// The fixture subject keeps Study/ only, so no deck folder matches it and nothing starts ticked.
		await expect(page.getByTestId('anki-import')).toBeDisabled();

		const networking = decks.filter({ hasText: 'CS::Networking' });
		await expect(networking.getByTestId('deck-target')).toHaveText(NETWORKING);
		await expect(networking.getByTestId('deck-count')).toHaveText('2 cards');
		await expect(networking.getByTestId('deck-sample')).toContainText('What is HTTP?');
		await expect(networking.getByTestId('deck-status')).toHaveText('New');

		expect(vaultFile(NETWORKING)).toBe('');
		expect(vaultFile(WISDOM)).toBe('');
	});

	test('writes each deck as a card file on Import, and leaves the .txt alone', async ({ page }) => {
		const before = vaultFile('Flashcards/CS/Networking.txt');
		await page.goto('/study/study/import');
		for (const box of await page.getByTestId('deck-choose').all()) await box.check();
		await expect(page.getByTestId('anki-import')).toHaveText('Import 2 decks');
		await page.getByTestId('anki-import').click();

		await expect(page.getByTestId('anki-summary')).toContainText('Created 2 card files holding 3 cards.');
		await expect(page.getByTestId('deck-status').first()).toHaveText('Created');

		const note = vaultFile(NETWORKING);
		expect(note).toContain('goal:\nsource: Flashcards/CS/Networking.txt\n');
		expect(note).toContain('#flashcards/cs/networking\n');
		expect(note).toContain('What is HTTP?::Hyper Text Transfer Protocol\n');
		expect(note).toContain('What does a GET look like?\n?\nA request line\n```\nGET / HTTP/1.1\nHost: example.com\n```\n');
		// The Rust path is not a separator, so the card is written multiline.
		expect(vaultFile(WISDOM)).toContain('Where does stdin live in Rust?\n?\nstd::io::stdin\n');
		expect(vaultFile('Flashcards/CS/Networking.txt')).toBe(before);

		// The three new cards join the fixture's one due card in the review queue.
		await page.goto('/study/study/review');
		await expect(page.getByTestId('card-left')).toHaveText('4 left');
	});

	test('skips a deck whose card file is already there, and says so', async ({ page }) => {
		const mine = '# My own Wisdom cards\n';
		mkdirSync(dirname(join(VAULT, WISDOM)), { recursive: true });
		writeFileSync(join(VAULT, WISDOM), mine);

		await page.goto('/study/study/import');
		const wisdom = page.getByTestId('anki-deck').filter({ hasText: 'Wisdom' });
		await expect(wisdom.getByTestId('deck-status')).toHaveText('Already there');
		await expect(page.getByTestId('anki-plan')).toContainText('1 to create, 1 already there');

		await page.getByTestId('deck-choose').check();
		await page.getByTestId('anki-import').click();
		await expect(page.getByTestId('anki-summary')).toContainText('Created 1 card file holding 2 cards.');
		await expect(page.getByTestId('anki-summary')).toContainText('Skipped 1 deck whose file was already there.');
		expect(vaultFile(WISDOM)).toBe(mine);
	});
});
