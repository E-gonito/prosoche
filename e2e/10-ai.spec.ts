import { test, expect } from '@playwright/test';
import { TODAY, TODAY_NOTE, vaultFile, resetVault } from './helpers';

/**
 * The AI surfaces with the layer switched off, which is guardrail G10 and is
 * the state every new install is in.
 *
 * There is no `claude` binary in this environment and no budget, so nothing a
 * model would produce can be tested here. What can be, and is what actually
 * matters, is that every surface loads, offers its control, and — when it is
 * pressed — says plainly that the layer is off instead of hanging, throwing,
 * or writing something. And that after all of it, not one byte of the vault
 * has changed.
 */
test.describe('the AI layer, switched off', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('the briefing card offers to generate and refuses out loud', async ({ page }) => {
		await page.goto('/');
		const card = page.getByTestId('briefing');
		await expect(card).toBeVisible();
		await expect(card).toContainText('No briefing yet today');

		const before = vaultFile(TODAY_NOTE);
		await page.getByTestId('briefing-regenerate').click();
		await expect(card).toContainText(/switched off|disabled|off/i);
		expect(vaultFile(TODAY_NOTE)).toBe(before);
	});

	test('the briefing button is only on today, because only today has a briefing', async ({ page }) => {
		// Regenerating a past day's briefing would describe a day that is
		// already over. A past day with no briefing in its note draws no strip
		// at all now, which is the same statement made more quietly.
		await page.goto('/day/2026-11-03');
		await expect(page.getByTestId('block').first()).toBeVisible();
		await expect(page.getByTestId('briefing-regenerate')).toHaveCount(0);
		await expect(page.getByTestId('briefing')).toHaveCount(0);

		// On today it is there, with the button on it.
		await page.goto('/');
		await expect(page.getByTestId('briefing')).toBeVisible();
		await expect(page.getByTestId('briefing-regenerate')).toBeVisible();
	});

	test('the review page says what would arrive and that nothing has', async ({ page }) => {
		await page.goto('/review');
		await expect(page.getByTestId('review-empty')).toBeVisible();
		await expect(page.locator('body')).toContainText('switched off');
		await expect(page.getByTestId('review-item')).toHaveCount(0);
	});

	test('Ask offers no box at all rather than one that cannot work', async ({ page }) => {
		await page.goto('/ask');
		// Better than a box that takes a question and then refuses it: the page
		// says what is wrong and where to change it.
		await expect(page.locator('body')).toContainText('AI is switched off');
		await expect(page.locator('main').getByRole('link', { name: /Settings/ })).toBeVisible();
		await expect(page.getByTestId('ask-question')).toHaveCount(0);
	});

	test('the settings page shows every feature and every guardrail', async ({ page }) => {
		await page.goto('/settings/ai');
		const body = page.locator('body');
		await expect(body).toContainText('Ask');
		await expect(body).toContainText('Morning briefing');
		await expect(body).toContainText('Suggest flashcards');
		await expect(body).toContainText('Timesheet draft');
	});

	test('the inbox widget lists the capture note by lines, not just notes', async ({ page }) => {
		await page.goto('/w/thinking/ask');
		const inbox = page.getByTestId('inbox-widget');
		await expect(inbox).toContainText('Ask whether the parser handles tab indents');
		await expect(inbox).toContainText('Chase the sign-off on the spec');
		// A capture already ticked has been dealt with, so it is not offered again.
		await expect(inbox).not.toContainText('Already dealt with');
	});

	test('filing a capture refuses rather than writing anything', async ({ page }) => {
		await page.goto('/w/thinking/ask');
		const before = vaultFile('Inbox/Capture.md');
		await page.getByTestId('draft-run').first().click();
		await expect(page.getByTestId('draft-problem').first()).toBeVisible();
		expect(vaultFile('Inbox/Capture.md')).toBe(before);
	});

	test('suggesting cards refuses rather than writing to the note', async ({ page }) => {
		await page.goto('/notes/Reference/Handshakes.md');
		const before = vaultFile('Reference/Handshakes.md');
		await page.getByTestId('draft-run').click();
		await expect(page.getByTestId('draft-problem')).toBeVisible();
		expect(vaultFile('Reference/Handshakes.md')).toBe(before);
	});

	test('the timesheet draft is built from the vault even with no model', async ({ page }) => {
		await page.goto('/w/polish/day');
		await page.getByTestId('draft-run').click();
		// The facts are queries, so the draft still has its date heading.
		const [y, m, d] = TODAY.split('-');
		await expect(page.getByTestId('draft-text')).toContainText(`# ${d}/${m}/${y}`);
	});

	test('the timesheet itself is never offered as a destination', async ({ page }) => {
		await page.goto('/w/polish/day');
		await page.getByTestId('draft-run').click();
		await expect(page.locator('body')).toContainText('never writes that file');
		await expect(page.locator('body')).not.toContainText(/TIMESHEET \w+\.md/);
	});
});
