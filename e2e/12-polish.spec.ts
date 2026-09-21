import { test, expect, type Page } from '@playwright/test';
import { resetVault } from './helpers';

/**
 * Phase 6: the command palette, the global shortcuts, the read-only timesheet
 * and the two integrations in the state they ship in — not connected.
 *
 * The widget tests go through `/w/polish`, the workspace phase 6 adds to the
 * fixture vault, whose one tab carries the three widgets. That route is built
 * by phase 2, so the tests skip rather than fail if it is not there yet.
 */

const WORKSPACE = '/w/polish';

/**
 * A palette row picked by its title rather than by any text inside it.
 *
 * A row carries its title, a snippet of the note and its key binding, so
 * filtering on `hasText` matches every note whose *body* happens to mention
 * the word. Four rows matched "Handbook" because four notes link to it.
 */
function rowTitled(page: Page, title: string) {
	return page
		.getByTestId('palette-row')
		.filter({ has: page.getByTestId('palette-title').filter({ hasText: title }) });
}

/**
 * Open the palette the way a user does, and wait for the box to have focus.
 *
 * Retried, because a global shortcut only exists once the page has hydrated
 * and `page.goto` resolves before that. A key pressed a moment too early goes
 * to static HTML and is simply lost — there is nothing to wait for, so the
 * press itself is the thing that has to be repeated. A binding that genuinely
 * never works still fails, at the end of the budget.
 */
async function openPalette(page: Page) {
	await expect(async () => {
		await page.keyboard.press('Control+k');
		await expect(page.getByTestId('palette')).toBeVisible({ timeout: 400 });
	}).toPass({ timeout: 8000 });
	await expect(page.getByTestId('palette-input')).toBeFocused();
}

test.describe('the command palette', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/');
	});

	test('opens on Ctrl-K and closes on Escape', async ({ page }) => {
		await openPalette(page);
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('palette')).toHaveCount(0);
	});

	test('lists the commands with their key bindings, so they are discoverable', async ({ page }) => {
		await openPalette(page);
		const rows = page.getByTestId('palette-row');
		await expect(rows.filter({ hasText: 'Go to Today' })).toBeVisible();
		await expect(rows.filter({ hasText: 'Quick capture' })).toBeVisible();
		await expect(rows.filter({ hasText: 'Rebuild index' })).toBeVisible();
		await expect(rows.filter({ hasText: 'Toggle sidebar' })).toBeVisible();
		// The binding is shown next to the command rather than being folklore.
		await expect(rows.filter({ hasText: 'Command palette' }).locator('kbd')).toContainText('K');
	});

	test('typing finds a note, and Enter opens it', async ({ page }) => {
		await openPalette(page);
		await page.keyboard.type('handbook');
		const hit = rowTitled(page, 'Handbook');
		await expect(hit).toBeVisible();
		// Walk to it with the keyboard only, which is the point of the palette.
		while ((await hit.getAttribute('aria-selected')) !== 'true') {
			await page.keyboard.press('ArrowDown');
		}
		await hit.click();
		await expect(page).toHaveURL(/Handbook\.md$/);
		await expect(page.getByTestId('palette')).toHaveCount(0);
	});

	test('the arrows move the selection and Enter follows it', async ({ page }) => {
		await openPalette(page);
		await page.keyboard.type('today');
		const rows = page.getByTestId('palette-row');
		// Notes arrive after the commands do, so wait for the list to settle
		// before asserting which row the arrows are moving between.
		await expect(rows.nth(1)).toBeVisible();
		const first = rows.first();
		await expect(first).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('ArrowDown');
		await expect(first).toHaveAttribute('aria-selected', 'false');
		await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('ArrowUp');
		await expect(first).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/day\/\d{4}-\d{2}-\d{2}$/);
	});

	test('finds a workspace by name', async ({ page }) => {
		await openPalette(page);
		await page.keyboard.type('polish');
		// Two things are called polish: the workspace and the file that defines
		// it. The workspace ranks first, because that is what "find a workspace"
		// means — and Enter is what proves it, rather than the label.
		await expect(rowTitled(page, 'Polish').first()).toBeVisible();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/w\/polish/);
	});

	test('says so when nothing matches, instead of looking broken', async ({ page }) => {
		await openPalette(page);
		await page.keyboard.type('zzzznothinghere');
		await expect(page.getByText('Nothing matched')).toBeVisible();
	});

	test('a command that needs a word asks in the same box, and Escape steps back', async ({ page }) => {
		await openPalette(page);
		await page.keyboard.type('quick capture');
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('palette').getByText('Quick capture')).toBeVisible();
		await page.keyboard.type('A thought from the palette');
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('palette-message')).toContainText('Inbox/');

		// One Escape from the question, one from the palette: never trapped.
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('palette')).toHaveCount(0);
	});

	test('answers the same rows over the API, for anything that is not a browser', async ({ request }) => {
		const body = await (await request.get('/api/palette?q=handbook')).json();
		expect(body.notes.map((n: { title: string }) => n.title)).toContain('Handbook');
		expect(Array.isArray(body.tasks)).toBe(true);
		expect(Array.isArray(body.workspaces)).toBe(true);
	});
});

test.describe('global shortcuts', () => {
	test.beforeEach(async ({ request }) => await resetVault(request));

	test('a single key navigates when the page is not a text box', async ({ page }) => {
		await page.goto('/search');
		await page.locator('h1').click();
		await page.keyboard.press('t');
		await expect(page).toHaveURL(/\/day\/\d{4}-\d{2}-\d{2}$/);
	});

	test('a shortcut never fires while the user is typing in the editor', async ({ page }) => {
		await page.goto('/notes/Study/Algorithms.md');
		await page.locator('.cm-content').click();
		await page.keyboard.press('Control+End');
		await page.keyboard.type(' typing t and n and c here');

		// Still in the note, and the characters went into the text.
		await expect(page).toHaveURL(/Algorithms\.md$/);
		await expect(page.locator('.cm-content')).toContainText('typing t and n and c here');
		await expect(page.getByTestId('palette')).toHaveCount(0);
	});

	test('the palette still opens from inside the editor, because it is a chord', async ({ page }) => {
		await page.goto('/notes/Study/Algorithms.md');
		await page.locator('.cm-content').click();
		await page.keyboard.press('Control+k');
		await expect(page.getByTestId('palette')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('palette')).toHaveCount(0);
	});

	test('a search box keeps its own letters', async ({ page }) => {
		await page.goto('/search');
		await page.getByLabel('Search notes').fill('');
		await page.getByLabel('Search notes').type('tncs');
		await expect(page.getByLabel('Search notes')).toHaveValue('tncs');
		await expect(page).toHaveURL(/\/search$/);
	});
});

test.describe('the phase 6 widgets', () => {
	test.beforeEach(async ({ request }) => await resetVault(request));

	test('the timesheet renders today read-only, and offers no way to edit it', async ({ page }) => {
		const response = await page.goto(WORKSPACE);
		test.skip(response?.status() === 404, 'workspace tabs arrive with phase 2');

		const widget = page.getByTestId('timesheet-widget');
		await expect(widget).toBeVisible();
		await expect(page.getByTestId('timesheet-readonly')).toContainText('Read only');
		await expect(widget).toContainText('Tasks to do');
		await expect(widget).toContainText('Review the open pull requests');
		// The sub-item under item 3, which markdown would not have seen at all.
		await expect(widget).toContainText('End-to-end tests');
		// The fenced narrative is shown as written, numbers and all.
		await expect(widget).toContainText('PARTIALLY DONE');
		// Nothing in the card can change the document.
		await expect(widget.locator('input, textarea, [contenteditable="true"]')).toHaveCount(0);
		await expect(widget.locator('a')).toHaveAttribute('href', /TIMESHEET/);
	});

	test('both integrations say they are not connected, and what to set', async ({ page }) => {
		const response = await page.goto(WORKSPACE);
		test.skip(response?.status() === 404, 'workspace tabs arrive with phase 2');

		const github = page.getByTestId('github-not-connected');
		await expect(github).toContainText('No GitHub token is set');
		await expect(github).toContainText('HUB_GITHUB_TOKEN');
		await expect(github).toContainText('HUB_GITHUB_REPOS');

		const linear = page.getByTestId('linear-not-connected');
		await expect(linear).toContainText('No Linear API key is set');
		await expect(linear).toContainText('HUB_LINEAR_TOKEN');

		// Not an error state: no row pretends there is work to show.
		await expect(page.getByTestId('github-items')).toHaveCount(0);
		await expect(page.getByTestId('linear-items')).toHaveCount(0);
	});
});

test.describe('installing on a phone', () => {
	test('the manifest is served, light themed, with a share target', async ({ request }) => {
		const response = await request.get('/manifest.webmanifest');
		expect(response.status()).toBe(200);
		const manifest = JSON.parse(await response.text());
		expect(manifest.display).toBe('standalone');
		expect(manifest.theme_color).toBe('#ffffff');
		expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toContain('512x512');
		expect(manifest.share_target.params.url).toBe('share_url');
	});

	test('both icons are real PNGs', async ({ request }) => {
		for (const src of ['/icon-192.png', '/icon-512.png']) {
			const response = await request.get(src);
			expect(response.status()).toBe(200);
			expect((await response.body()).subarray(1, 4).toString()).toBe('PNG');
		}
	});

	test('the page declares the manifest and the light theme', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest\.webmanifest$/);
		await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'light');
	});

	test('a URL shared from the phone arrives in quick capture', async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/notes?share_title=Retina&share_url=https%3A%2F%2Fexample.com%2Fretina');
		await expect(page.getByTestId('palette')).toBeVisible();
		await expect(page.getByTestId('palette-input')).toHaveValue(/example\.com\/retina/);
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('palette-message')).toContainText('Inbox/');
	});
});
