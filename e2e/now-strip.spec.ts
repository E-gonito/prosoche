import { test, expect, type APIRequestContext } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetVault, TODAY, TODAY_NOTE, VAULT } from './helpers';

/**
 * The now strip and the Start links on Today.
 *
 * The strip depends on the real clock of the machine running the suite (the
 * server is local and uses the same one), so the strip tests write today's
 * note with a block placed relative to now: started two minutes ago to be due,
 * starting in ten to be soon. Near midnight that does not fit in the day, so
 * those tests skip rather than guess. The Today test uses the base vault and
 * does not care what time it is.
 */

const BLOCK = 'Strip test block';
const clock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const nowMin = () => {
	const d = new Date();
	return d.getHours() * 60 + d.getMinutes();
};

/** Replace today's note with one open block from `start` for half an hour (line 1, 0-based), and re-index. */
async function planBlockAt(request: APIRequestContext, start: number) {
	writeFileSync(join(VAULT, TODAY_NOTE), `# Tasks\n- [ ] ${clock(start)} - ${clock(start + 30)} ${BLOCK} \`Q2\`\n`);
	await request.post('/api/sync', { data: { action: 'rebuild' } });
}

/** The strip as drawn: the rail's on a desktop viewport, so only one is visible. */
const strip = (page: import('@playwright/test').Page) => page.locator('[data-testid="now-strip"]:visible');

test.describe('The now strip', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('a due block shows on any page, Start leads to its start page, and the session then shows as running', async ({ page, request }) => {
		const start = nowMin() - 2;
		test.skip(start < 0 || start + 30 > 1440, 'needs the block to fit in today');
		await planBlockAt(request, start);

		await page.goto('/notes');
		await expect(strip(page)).toHaveAttribute('data-state', 'due');
		await expect(strip(page)).toContainText(BLOCK);
		await expect(strip(page)).toContainText(/started [23] min ago/);
		await expect(page).toHaveTitle(/^Due: Strip test block · /);

		await strip(page).getByTestId('now-start').click();
		await expect(page).toHaveURL(`/focus/start?day=${TODAY}&line=1`);
		await expect(page.getByTestId('start-text')).toHaveText(BLOCK);
		await page.getByTestId('start-block').click();
		await expect(page).toHaveURL('/focus');

		// Running wins: the same strip, now the session, on every page and in the tab title.
		await expect(strip(page)).toHaveAttribute('data-state', 'running');
		await expect(strip(page)).toContainText('Just five minutes');
		await page.goto('/notes');
		await expect(strip(page)).toHaveAttribute('data-state', 'running');
		await expect(strip(page).getByTestId('now-start')).toHaveCount(0);
		await expect(page).toHaveTitle(/^▶ \d+:\d\d · /);
		await strip(page).getByTestId('now-link').click();
		await expect(page).toHaveURL('/focus');
		// /focus keeps its own title, with no second prefix.
		await expect(page).toHaveTitle(/^▶ \d+:\d\d · Strip test block · prosoche$/);

		await page.getByTestId('end-skipped').click();
		await expect(page).toHaveURL('/today');
		// It has been started, so it is no longer due.
		await expect(strip(page)).toHaveCount(0);
	});

	test('a block about to start counts down, quietly, and links to its start page', async ({ page, request }) => {
		const start = nowMin() + 10;
		test.skip(start + 30 > 1440, 'needs the block to fit in today');
		await planBlockAt(request, start);

		await page.goto('/notes');
		await expect(strip(page)).toHaveAttribute('data-state', 'soon');
		await expect(strip(page)).toContainText(BLOCK);
		await expect(strip(page)).toContainText(/in (9|10):\d\d/);
		await expect(strip(page).getByTestId('now-start')).toHaveCount(0);
		// No title prefix for soon.
		await expect(page).not.toHaveTitle(/^(Due|▶)/);
		await strip(page).getByTestId('now-link').click();
		await expect(page).toHaveURL(`/focus/start?day=${TODAY}&line=1`);
	});

	test('draws nothing when no block is near', async ({ page, request }) => {
		const start = nowMin() + 120;
		test.skip(start + 30 > 1440, 'needs the block to fit in today');
		await planBlockAt(request, start);
		await page.goto('/notes');
		await expect(page.getByTestId('jump')).toBeVisible();
		await expect(strip(page)).toHaveCount(0);
	});
});

test.describe('Start on Today', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('an open timed block has a Start link to its own start page; a ticked one has none', async ({ page }) => {
		await page.goto('/today');
		const open = page.getByTestId('block').filter({ hasText: 'Read a book' });
		await expect(open.getByTestId('timeline-start')).toHaveCount(1);
		await expect(open.getByTestId('timeline-start')).toHaveAttribute('href', /^\/focus\/start\?day=\d{4}-\d\d-\d\d&line=\d+$/);
		await expect(page.getByTestId('block').filter({ hasText: 'Morning stretch' }).getByTestId('timeline-start')).toHaveCount(0);

		// Pressing it follows the link and neither opens the card nor drags the block.
		await open.scrollIntoViewIfNeeded();
		await open.hover();
		await open.getByTestId('timeline-start').click();
		await expect(page).toHaveURL(new RegExp(`^.*/focus/start\\?day=${TODAY}&line=\\d+$`));
		await expect(page.getByTestId('start-text')).toHaveText('Read a book');
	});

	test('another day has no Start links', async ({ page }) => {
		const d = new Date();
		d.setDate(d.getDate() - 1);
		const pad = (n: number) => String(n).padStart(2, '0');
		await page.goto(`/today/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
		await expect(page.getByTestId('timeline-start')).toHaveCount(0);
	});
});
