import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { TODAY, VAULT, vaultFile, lineWith } from './helpers';

const LEDGER = 'Private/Dating/Ledger.md';
const ADA = 'Private/Dating/People/Ada.md';

async function tap(page: import('@playwright/test').Page, testId: string, times = 1) {
	for (let i = 0; i < times; i++) await page.getByTestId(testId).click();
}

test.describe.serial('Date', () => {
	test('logs today with the counters and saves the exact ledger line', async ({ page }) => {
		await page.goto('/date');
		await expect(page.locator('.day b')).toHaveText('Today');

		await tap(page, 'dating-sent-plus', 3);
		await tap(page, 'dating-matches-plus', 2);
		await tap(page, 'dating-type-plus', 1);
		await tap(page, 'dating-received-plus', 1);
		await page.getByTestId('dating-notes').fill('good energy today');

		await expect(page.getByTestId('dating-save')).toHaveText('Save');
		await page.getByTestId('dating-save').click();
		await expect(page.getByTestId('dating-save')).toHaveText('Saved');

		expect(lineWith(LEDGER, TODAY).text).toBe(
			`- ${TODAY} sent:: 3 matches:: 2 type:: 1 received:: 1 notes:: good energy today`
		);
		// The line notes.mjs seeded is still there, untouched.
		expect(vaultFile(LEDGER)).toContain('- 2026-09-01 sent:: 3 matches:: 1');
	});

	test('re-saving the day changes only the fields that changed', async ({ page }) => {
		await page.goto('/date');
		await expect(page.getByTestId('dating-sent-value')).toHaveText('3');
		await expect(page.getByTestId('dating-notes')).toHaveValue('good energy today');

		await tap(page, 'dating-sent-plus', 1);
		await page.getByTestId('dating-save').click();
		await expect(page.getByTestId('dating-save')).toHaveText('Saved');

		expect(lineWith(LEDGER, TODAY).text).toBe(
			`- ${TODAY} sent:: 4 matches:: 2 type:: 1 received:: 1 notes:: good energy today`
		);
		expect(vaultFile(LEDGER)).toContain('- 2026-09-01 sent:: 3 matches:: 1');
	});

	test('loads the day again with what was saved when stepping to it', async ({ page }) => {
		await page.goto(`/date?day=2026-09-01`);
		await expect(page.getByTestId('dating-sent-value')).toHaveText('3');
		await expect(page.getByTestId('dating-matches-value')).toHaveText('1');
		await expect(page.getByTestId('dating-save')).toHaveText('Save');
	});

	test('shows the right match rate on Stats', async ({ page }) => {
		// Ledger now: 2026-09-01 sent 3 matches 1; today sent 4 matches 2.
		// All-time: sent 7, matches 3 -> 43%.
		await page.goto('/date/stats');
		await expect(page.getByTestId('dating-match-rate-all')).toHaveText('43%');
	});

	test('lists days newest first on History, and a day opens on Log', async ({ page }) => {
		await page.goto('/date/history');
		const rows = page.getByTestId('dating-history-day');
		await expect(rows.first()).toContainText(TODAY);
		await expect(rows.last()).toContainText('2026-09-01');

		await rows.first().click();
		await expect(page).toHaveURL(`/date?day=${TODAY}`);
	});

	test('adds a person and a date', async ({ page }) => {
		await page.goto('/date/people');
		await page.getByTestId('dating-add-name').fill('Grace Hopper');
		await page.getByTestId('dating-add-submit').click();
		await expect(page.getByRole('link', { name: 'Grace Hopper' })).toBeVisible();

		await page.getByRole('link', { name: 'Grace Hopper' }).click();
		await expect(page.locator('h2')).toHaveText('Grace Hopper');

		await page.getByTestId('dating-date-text').fill('Drinks at the Ivy');
		await page.getByTestId('dating-date-submit').click();
		await expect(page.getByTestId('dating-dates-log')).toContainText('Drinks at the Ivy');

		expect(vaultFile('Private/Dating/People/Grace Hopper.md')).toContain('type: person');
	});

	test('changes a person\'s stage by rewriting only that one line', async ({ page }) => {
		const before = vaultFile(ADA);
		await page.goto('/date/people/Ada');
		await expect(page.getByTestId('dating-stage-select')).toHaveValue('talking');

		const [response] = await Promise.all([
			page.waitForResponse('/api/dating/people/stage'),
			page.getByTestId('dating-stage-select').selectOption('dating')
		]);
		expect(response.ok()).toBe(true);
		await expect(page.getByTestId('dating-stage-select')).toHaveValue('dating');

		const after = vaultFile(ADA);
		const beforeLines = before.split('\n');
		const afterLines = after.split('\n');
		expect(afterLines).toHaveLength(beforeLines.length);
		const changed = afterLines.filter((line, i) => line !== beforeLines[i]);
		expect(changed).toEqual(['stage: dating']);
	});

	test('privacy: nothing under Private/ was ever committed, and it stays out of search and sync', async ({ page }) => {
		const status = execFileSync('git', ['-C', VAULT, 'status', '--porcelain'], { encoding: 'utf8' });
		expect(status).not.toMatch(/Private/);

		const log = execFileSync('git', ['-C', VAULT, 'log', '--all', '--name-only'], { encoding: 'utf8' });
		expect(log).not.toMatch(/Private/);

		const sync = await page.request.get('/api/sync');
		const syncBody = await sync.json();
		expect((syncBody.pending ?? []).some((p: string) => p.startsWith('Private/'))).toBe(false);

		const search = await page.request.get('/api/search?q=Grace');
		const searchBody = await search.json();
		expect(searchBody.hits ?? []).toEqual([]);
	});

	test('logs a like with the quick add, clamps a 0, and settles it with one tap', async ({ page }) => {
		await page.goto('/date');
		await page.getByTestId('like-label').fill('Iris');
		await page.getByTestId('like-forecast').fill('0');
		await expect(page.getByTestId('like-forecast-clamp')).toContainText('Saves as 2%');
		await page.getByTestId('like-fits-type').getByRole('button', { name: 'Yes' }).click();
		await page.getByTestId('like-age').fill('27');
		await page.getByTestId('like-submit').click();
		await expect(page.getByTestId('like-added')).toContainText('Iris');

		const path = 'Private/Dating/People/Iris.md';
		const note = vaultFile(path);
		expect(note).toContain('stage: liked');
		expect(note).toContain(`liked: ${TODAY}`);
		expect(note).toContain('chance: 2\n');
		expect(note).toContain('fits_type: true');
		expect(note).toContain('age: 27');
		expect(note).toContain('status: pending');
		expect(note).not.toContain('out_of_league');

		await page.goto('/date/likes');
		const row = page.getByTestId('like-pending').filter({ hasText: 'Iris' });
		await expect(row).toContainText('2% · today');
		await row.getByTestId('like-yes').click();
		await expect(page.getByTestId('like-pending').filter({ hasText: 'Iris' })).toHaveCount(0);
		expect(vaultFile(path)).toContain('status: yes');
		expect(vaultFile(path)).toContain('stage: talking');

		// It is still there after a reload, under its outcome.
		await page.reload();
		await page.getByTestId('likes-filter').getByRole('button', { name: 'yes' }).click();
		await expect(page.getByTestId('like-row').filter({ hasText: 'Iris' })).toContainText('yes');

		await page.goto('/date/stats');
		await expect(page.getByTestId('cal-resolved')).toContainText('1');
		await expect(page.getByTestId('cal-base-rate')).toHaveText('100%');
		await expect(page.getByTestId('cal-buckets')).toContainText('not enough data');
	});

	test('phone layout: the pending Yes and No are comfortably tappable', async ({ page, request }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const added = await request.post('/api/dating/likes', { data: { label: 'June', forecast: 10 } });
		expect(added.ok()).toBe(true);
		await page.goto('/date/likes');
		for (const testId of ['like-yes', 'like-no']) {
			const box = await page.getByTestId('like-pending').filter({ hasText: 'June' }).getByTestId(testId).boundingBox();
			expect(box!.width).toBeGreaterThanOrEqual(44);
			expect(box!.height).toBeGreaterThanOrEqual(44);
		}
		const form = await page.getByTestId('like-quick-add').boundingBox();
		expect(form!.width).toBeLessThanOrEqual(390);
	});

	test('phone layout: the day stepper and counters are comfortably tappable', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/date');
		await expect(page.getByTestId('dating-tabs')).toBeVisible();

		for (const testId of ['dating-prev-day', 'dating-sent-plus', 'dating-sent-minus']) {
			const box = await page.getByTestId(testId).boundingBox();
			expect(box).not.toBeNull();
			expect(box!.width).toBeGreaterThanOrEqual(44);
			expect(box!.height).toBeGreaterThanOrEqual(44);
		}

		await expect(page.getByTestId('dating-save')).toBeVisible();
	});
});
