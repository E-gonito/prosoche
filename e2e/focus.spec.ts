import { test, expect } from '@playwright/test';
import { lineWith, resetVault, TODAY, TODAY_NOTE, vaultFile } from './helpers';

/**
 * The focus session on a plain daily-note block, against the base vault's
 * today note: `14:00 - 14:30 Read a book` is not a study block, so it runs as a
 * "Focus" session. Study's own session is in `study.spec.ts`.
 */

const BLOCK = '- [ ] 14:00 - 14:30 Read a book `Q2`';

test.describe('A focus session on a block', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	const startUrl = () => `/focus/start?day=${TODAY}&line=${lineWith(TODAY_NOTE, 'Read a book').index}`;

	test('Start shows the block, the warm-up leads, and Made progress ticks it and logs one bullet', async ({ page }) => {
		const before = vaultFile(TODAY_NOTE);
		await page.goto(startUrl());
		await expect(page.getByTestId('start-text')).toHaveText('Read a book');
		await expect(page.getByTestId('start-time')).toHaveText('14:00 - 14:30');
		await page.getByTestId('start-block').click();

		await expect(page).toHaveURL('/focus');
		await expect(page.getByTestId('warmup-label')).toHaveText('Just five minutes');
		await expect(page.getByTestId('clock')).toHaveText(/^(4:[0-5]\d|5:00)$/);
		await expect(page).toHaveTitle(/^▶ \d+:\d\d · Read a book/);
		await expect(page.getByTestId('session-step')).toHaveText('Read a book');

		// Reloading keeps the session, and the starting page now goes straight to it.
		await page.reload();
		await expect(page.getByTestId('session')).toBeVisible();
		await page.goto(startUrl());
		await expect(page).toHaveURL('/focus');

		await page.getByTestId('scratch').fill('two chapters');
		await page.getByTestId('end-progress').click();
		await expect(page).toHaveURL('/today');

		const after = vaultFile(TODAY_NOTE);
		const minutes = /\t- Focus: Read a book, (\d+)m, progress · two chapters\n/.exec(after)?.[1];
		expect(minutes).toBeDefined();
		expect(after).toBe(before.replace(BLOCK, `- [x] 14:00 - 14:30 Read a book \`Q2\`\n\t- Focus: Read a book, ${minutes}m, progress · two chapters`));
	});

	test('Didn’t get to it ticks nothing but still logs the block as dealt with', async ({ page }) => {
		const before = vaultFile(TODAY_NOTE);
		await page.goto(startUrl());
		await page.getByTestId('start-block').click();
		await expect(page).toHaveURL('/focus');
		await page.getByTestId('end-skipped').click();
		await expect(page).toHaveURL('/today');
		const minutes = /\t- Focus: Read a book, (\d+)m, skipped\n/.exec(vaultFile(TODAY_NOTE))?.[1];
		expect(vaultFile(TODAY_NOTE)).toBe(before.replace(BLOCK, `${BLOCK}\n\t- Focus: Read a book, ${minutes}m, skipped`));
	});

	test('+15 min moves the block’s end in the note', async ({ page }) => {
		await page.goto(startUrl());
		await page.getByTestId('start-block').click();
		await page.getByTestId('extend').click();
		await expect.poll(() => vaultFile(TODAY_NOTE)).toContain('14:00 - 14:45 Read a book');
	});

	test('a line that is not an open timed block says so, and /focus with nothing running goes to Today', async ({ page }) => {
		await page.goto(`/focus/start?day=${TODAY}&line=0`);
		await expect(page.getByText('That block is not open any more')).toBeVisible();
		await page.getByTestId('focus-start').getByRole('link', { name: 'Today' }).click();
		await expect(page).toHaveURL('/today');
		await page.goto('/focus');
		await expect(page).toHaveURL('/today');
	});

	test('a second block is refused while one runs, naming the first', async ({ page }) => {
		await page.goto(startUrl());
		await page.getByTestId('start-block').click();
		await expect(page).toHaveURL('/focus');
		await page.goto(`/focus/start?day=${TODAY}&line=${lineWith(TODAY_NOTE, 'Client project').index}`);
		await expect(page.getByTestId('focus-start')).toContainText('Finish "Read a book" first.');
	});
});
