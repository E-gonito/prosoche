import { test, expect } from '@playwright/test';
import { resetVault } from './helpers';

/**
 * A note is something you read. Opening one used to drop you straight into a
 * text box, which meant every wikilink followed, every search result opened
 * and every link from the day page landed on an editor nobody had asked for.
 * These tests pin the other way round: prose by default, the editor only when
 * the URL, the button or the key says so.
 */
const NOTE = '/notes/Study/Algorithms.md';
const HANDBOOK = '/notes/Work/Handbook.md';

test.describe('reading a note', () => {
	test.beforeEach(async ({ request }) => await resetVault(request));

	test('a plain note URL renders the text, not an editor', async ({ page }) => {
		await page.goto(NOTE);
		await expect(page.locator('.prose h1')).toContainText('Algorithms');
		await expect(page.locator('.cm-editor')).toHaveCount(0);
	});

	test('Edit opens the editor, and Read comes back', async ({ page }) => {
		await page.goto(NOTE);
		await page.getByTestId('edit-toggle').click();

		await expect(page).toHaveURL(/Algorithms\.md\?edit=1$/);
		await expect(page.locator('.cm-content')).toContainText('Algorithms');
		// The button is named for what it does next, not for where you are.
		await expect(page.getByTestId('edit-toggle')).toHaveText(/Read/);

		await page.getByTestId('edit-toggle').click();
		await expect(page).toHaveURL(/Algorithms\.md$/);
		await expect(page.locator('.prose h1')).toContainText('Algorithms');
		await expect(page.locator('.cm-editor')).toHaveCount(0);
	});

	test('e edits, because the page is not a text box', async ({ page }) => {
		await page.goto(NOTE);
		await page.locator('.prose').click();
		await page.keyboard.press('e');
		await expect(page).toHaveURL(/Algorithms\.md\?edit=1$/);
		await expect(page.locator('.cm-content')).toContainText('Algorithms');
	});

	test('a wikilink in the reading view still navigates', async ({ page }) => {
		await page.goto(NOTE);
		await page.locator('.prose a', { hasText: 'Handbook' }).click();
		await expect(page).toHaveURL(/Handbook\.md$/);
		await expect(page.locator('.prose h1')).toContainText('Handbook');
	});

	test('a heading is not drawn like a link', async ({ page }) => {
		await page.goto(NOTE);
		const colour = (selector: string) =>
			page.locator(selector).first().evaluate((el) => getComputedStyle(el).color);
		const body = await page.evaluate(() => getComputedStyle(document.body).color);

		// A heading is body text. Blue was the whole complaint.
		expect(await colour('.prose h1')).toBe(body);
		expect(await colour('.prose h1')).not.toBe(await colour('.prose a'));
	});

	test('the editor draws the note title as a heading, not a link, either', async ({ page }) => {
		await page.goto(`${NOTE}?edit=1`);
		const heading = page.locator('.cm-line.cm-h1').first();
		await expect(heading).toBeVisible();
		const drawn = await heading.evaluate((el) => ({
			colour: getComputedStyle(el).color,
			// The highlighter decorates a span inside the line, not the line.
			underline: getComputedStyle(el.querySelector('span') ?? el).textDecorationLine
		}));
		expect(drawn.underline).toBe('none');
		expect(drawn.colour).toBe(await page.evaluate(() => getComputedStyle(document.body).color));
	});
});

test.describe('the rail beside a note', () => {
	test.beforeEach(async ({ request }) => await resetVault(request));

	test('is two cards: what the note says about itself, and what points at it', async ({ page }) => {
		await page.goto(HANDBOOK);
		await expect(page.locator('.rail .card')).toHaveCount(2);

		const about = page.getByTestId('about-card');
		await expect(about).toContainText('Properties');
		await expect(about).toContainText('org');
		await expect(about).toContainText('Acme');

		const links = page.getByTestId('links-card');
		await expect(links).toContainText('Backlinks');
		await expect(links).toContainText('Algorithms');
	});

	test('the About card groups tasks and tags under the same roof', async ({ page }) => {
		await page.goto(NOTE);
		const about = page.getByTestId('about-card');
		await expect(about).toContainText('Tags');
		await expect(about).toContainText('#study');
		await expect(about).toContainText('Tasks');
		await expect(about).toContainText('1 open of 1');
		await expect(page.locator('.rail .card')).toHaveCount(2);
	});

	test('says so plainly when nothing points here', async ({ page }) => {
		await page.goto('/notes/Inbox/README.md');
		await expect(page.getByTestId('links-card')).toContainText('No notes link here yet.');
	});

	test('drafting cards is a button beside the toggle, not a card of its own', async ({ page }) => {
		await page.goto(NOTE);
		const draft = page.getByTestId('draft-run');
		await expect(draft).toBeVisible();
		// Inside the note's own toolbar, where the Edit toggle is.
		await expect(page.locator('.crumb').getByTestId('draft-run')).toHaveCount(1);
		await expect(draft).toHaveAttribute('title', /Spaced Repetition/);
	});
});

test.describe('the notes index', () => {
	test.beforeEach(async ({ request }) => await resetVault(request));

	test('lists what was touched lately, beside the tree', async ({ page }) => {
		await page.goto('/notes');
		const recent = page.getByTestId('recent-notes');
		await expect(recent).toBeVisible();
		const rows = recent.locator('li');
		expect(await rows.count()).toBeGreaterThan(0);
		expect(await rows.count()).toBeLessThanOrEqual(10);
		// A title, where it is filed, and how long ago.
		await expect(rows.first()).toContainText(/today|yesterday|days ago|weeks ago|\d{4}-\d{2}-\d{2}/);
	});

	test('today is one click away', async ({ page }) => {
		await page.goto('/notes');
		await page.getByTestId('today-note').click();
		await expect(page).toHaveURL(/\/notes\/Journal\/\d{4}\/\d{2}\/\d{2}\.md$/);
		await expect(page.locator('.prose')).toBeVisible();
	});
});

test.describe('the file tree on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('lives in a sheet the Files button raises', async ({ page, request }) => {
		await resetVault(request);
		await page.goto(NOTE);

		// No room for it beside the note at this width.
		await expect(page.locator('.tree')).toBeHidden();

		await page.getByTestId('open-files').click();
		const sheet = page.getByTestId('files-sheet');
		await expect(sheet).toBeVisible();
		await expect(sheet.getByRole('link', { name: 'Syllabus' })).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(sheet).toHaveCount(0);
	});

	test('choosing a note from the sheet opens it and puts the sheet away', async ({ page, request }) => {
		await resetVault(request);
		await page.goto(NOTE);
		await page.getByTestId('open-files').click();
		await page.getByTestId('files-sheet').getByRole('link', { name: 'Syllabus' }).click();
		await expect(page).toHaveURL(/Syllabus\.md$/);
		await expect(page.getByTestId('files-sheet')).toHaveCount(0);
	});
});
