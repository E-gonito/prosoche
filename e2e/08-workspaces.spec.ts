import { test, expect } from '@playwright/test';
import { vaultFile, lineWith, dragTo, centre, waitForFile, resetVault } from './helpers';

const DECK = 'Work/Atlas/Tasks.md';
const PLAN = 'Work/Atlas/Test plan.md';
const MEETING = 'Work/Atlas/Meeting notes.md';

/** Which lines of a file differ from a snapshot taken before the action. */
function changedLines(path: string, before: string[]): number[] {
	return vaultFile(path)
		.split('\n')
		.map((line, i) => (line === before[i] ? null : i))
		.filter((i): i is number => i !== null);
}

test.describe('workspaces and boards', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/w/atlas');
	});

	test('the rail lists every workspace and the way to make another', async ({ page }) => {
		const nav = page.locator('nav').first();
		await expect(nav.getByRole('link', { name: 'Atlas' })).toBeVisible();
		// By href, because 'Study' is both a page in the nav and a workspace in
		// the rail, and the rail is what this test is about.
		await expect(nav.locator('a[href="/w/study"]')).toBeVisible();
		await expect(nav.locator('a[href="/w/work"]')).toBeVisible();
		await expect(nav.getByRole('link', { name: 'New workspace' })).toBeVisible();
	});

	test('a workspace page renders its tabs, with the first as the default', async ({ page }) => {
		await expect(page.getByTestId('workspace-name')).toHaveText('Atlas');
		await expect(page.getByTestId('tab')).toHaveText(['Board', 'Notes', 'Blocked']);
		await expect(page.locator('[data-widget="board"]')).toBeVisible();

		await page.getByTestId('tab').filter({ hasText: 'Notes' }).click();
		await expect(page).toHaveURL(/\/w\/atlas\/notes$/);
		await expect(page.getByTestId('notes-widget')).toContainText('Meeting notes');
		await expect(page.getByTestId('inbox-widget')).toContainText('Idea');
	});

	test('the workspace file is one link away, because that is where tabs live', async ({ page }) => {
		await page.getByTestId('edit-definition').click();
		await expect(page).toHaveURL(/_hub\/workspaces\/atlas\.md$/);
	});

	test('an unknown workspace is a 404 with the rail still beside it', async ({ page }) => {
		const response = await page.goto('/w/nothing-here');
		expect(response?.status()).toBe(404);
		await expect(page.getByText('There is no workspace called "nothing-here".')).toBeVisible();
		await expect(page.locator('nav').first().getByRole('link', { name: 'Atlas' })).toBeVisible();
	});

	test('the board puts each card in the column its markers name', async ({ page }) => {
		const column = (key: string) => page.locator(`[data-testid="column"][data-column="${key}"]`);
		await expect(page.getByTestId('column')).toHaveCount(4);

		await expect(column('to-do').getByTestId('card')).toHaveCount(4);
		await expect(column('in-progress').getByTestId('card')).toHaveText([/Take ownership/]);
		// A `#col/review` tag beats the status marker.
		await expect(column('review').getByTestId('card')).toHaveText([/Sitting with the reviewer/]);
		await expect(column('done').getByTestId('card')).toHaveText([/Renew the certificate/]);

		const blocked = column('to-do').getByTestId('card').filter({ hasText: 'Ship the release' });
		await expect(blocked.getByTestId('card-blocked')).toHaveText(/1/);
		await expect(
			column('to-do').getByTestId('card').filter({ hasText: 'Draft the anonymisation plan' }).getByTestId('card-due')
		).toBeVisible();
	});

	test('moving a card from the keyboard rewrites one character in the note', async ({ page }) => {
		const before = vaultFile(DECK).split('\n');
		const card = page.getByTestId('card').filter({ hasText: 'Draft the anonymisation plan' });
		await card.getByTestId('move-card').selectOption('in-progress');

		expect(await waitForFile(DECK, (c) => c.includes('- [/] Draft the anonymisation plan'))).toBe(true);
		expect(changedLines(DECK, before)).toHaveLength(1);
		// The card follows, without a reload.
		await expect(
			page.locator('[data-column="in-progress"]').getByTestId('card').filter({ hasText: 'Draft the anonymisation' })
		).toBeVisible();
	});

	test('moving a card to a named column tags it and leaves the marker alone', async ({ page }) => {
		const card = page.getByTestId('card').filter({ hasText: 'Take ownership' });
		await card.getByTestId('move-card').selectOption('review');

		expect(await waitForFile(DECK, (c) => c.includes('#col/review\n- [ ] Ship'))).toBe(true);
		expect(lineWith(DECK, 'Take ownership').text).toBe(
			'- [/] Take ownership of the grading pipeline `Q1` #col/review'
		);
	});

	test('dragging a card into another column moves it in the file', async ({ page }) => {
		const grip = await centre(page, '[data-testid="card"]:has-text("Renew the certificate") [data-testid="card-grip"]');
		const target = await page.locator('[data-column="to-do"]').boundingBox();
		await dragTo(page, grip, { x: target!.x + target!.width / 2, y: target!.y + target!.height - 30 });

		expect(await waitForFile(DECK, (c) => c.includes('- [ ] Renew the certificate'))).toBe(true);
		await expect(
			page.locator('[data-column="to-do"]').getByTestId('card').filter({ hasText: 'Renew the certificate' })
		).toBeVisible();
	});

	test('creating a card appends one line to the deck and nothing else', async ({ page }) => {
		const before = vaultFile(DECK);
		const column = page.locator('[data-column="to-do"]');
		await column.getByTestId('new-card').fill('Book the anonymisation review');
		await column.getByTestId('add-card').click();

		expect(await waitForFile(DECK, (c) => c.includes('Book the anonymisation review'))).toBe(true);
		const after = vaultFile(DECK);
		expect(after.startsWith(before)).toBe(true);
		expect(after.slice(before.length)).toBe('- [ ] Book the anonymisation review #ws/atlas\n');
		await expect(column.getByTestId('card').filter({ hasText: 'Book the anonymisation review' })).toHaveCount(1);
	});

	test('the drawer opens on a card, renames it, and closes with Escape', async ({ page }) => {
		const before = vaultFile(DECK).split('\n');
		await page.getByTestId('card').filter({ hasText: 'Ship the release' }).getByTestId('open-card').click();

		const drawer = page.getByTestId('card-drawer');
		await expect(drawer).toBeVisible();
		await expect(drawer.getByTestId('drawer-blockedby')).toHaveValue('dcm1');

		await drawer.getByTestId('drawer-text').fill('Ship the release candidate');
		await drawer.getByTestId('drawer-text').press('Enter');

		expect(await waitForFile(DECK, (c) => c.includes('Ship the release candidate'))).toBe(true);
		// The words change; the quadrant and the dependency stay where they were.
		expect(lineWith(DECK, 'Ship the release').text).toBe('- [ ] Ship the release candidate `Q3` ⛔ dcm1');
		expect(changedLines(DECK, before)).toHaveLength(1);

		await drawer.press('Escape');
		await expect(drawer).toBeHidden();
	});

	test('the drawer changes a quadrant and a due date on the line it belongs to', async ({ page }) => {
		await page.getByTestId('card').filter({ hasText: 'Renew the certificate' }).getByTestId('open-card').click();
		const drawer = page.getByTestId('card-drawer');
		await drawer.getByTestId('drawer-quadrant').selectOption('1');
		expect(await waitForFile(DECK, (c) => c.includes('- [x] Renew the certificate `Q1`'))).toBe(true);

		await drawer.getByTestId('drawer-due').fill('2026-12-01');
		expect(await waitForFile(DECK, (c) => c.includes('📅 2026-12-01'))).toBe(true);
	});

	test('the board says what it left out, and promotes a line only when asked', async ({ page }) => {
		const excluded = page.getByTestId('excluded');
		await expect(excluded).toContainText('4');
		await expect(excluded).toContainText('checklist notation');

		await page.getByTestId('review-excluded').click();
		const line = page.getByTestId('candidate').filter({ hasText: 'an upload with no title' });
		await expect(line).toBeVisible();
		// Nothing has been written just by looking at them.
		expect(vaultFile(PLAN)).toContain('- [ ] **Upload:** an upload with no title\n');

		await line.getByTestId('promote-q2').click();
		expect(await waitForFile(PLAN, (c) => c.includes('- [ ] **Upload:** an upload with no title `Q2`'))).toBe(
			true
		);
		// It is a card now, and no longer offered for promotion.
		await expect(page.getByTestId('card').filter({ hasText: 'an upload with no title' })).toHaveCount(1);
		await expect(page.getByTestId('candidate').filter({ hasText: 'an upload with no title' })).toHaveCount(0);
	});

	test('blocked shows what a card waits on, including another workspace', async ({ page }) => {
		await page.getByTestId('tab').filter({ hasText: 'Blocked' }).click();
		const blocked = page.getByTestId('blocked-widget');
		await expect(blocked).toContainText('Ship the release');
		await expect(blocked).toContainText('Draft the anonymisation plan');
		// A Study card waiting on an Atlas one, labelled as Study's.
		await expect(blocked).toContainText('Read the pipeline docs');
		await expect(blocked).toContainText('Study');
	});

	test('pinned lists a pinned card and unpinning it edits the line', async ({ page }) => {
		await page.getByTestId('tab').filter({ hasText: 'Blocked' }).click();
		const pinned = page.getByTestId('pinned-widget');
		await expect(pinned).toContainText('Chase the sample files');

		await pinned.getByTestId('unpin').first().click();
		expect(await waitForFile(MEETING, (c) => !c.includes('#pin'))).toBe(true);
		expect(lineWith(MEETING, 'Chase the sample files').text).toBe(
			'- [ ] Chase the sample files #ws/atlas `Q1`'
		);
	});
});

test.describe('the new-workspace wizard', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/w/new');
	});

	test('shows the file it will write and the tag it will claim', async ({ page }) => {
		await page.getByTestId('ws-name').fill('Riverside Clinic');
		const preview = page.getByTestId('ws-preview');
		await expect(preview).toContainText('_hub/workspaces/riverside-clinic.md');
		await expect(preview).toContainText('#ws/riverside-clinic');
	});

	test('reports a taken name in the form rather than on an error page', async ({ page }) => {
		await page.getByTestId('ws-name').fill('Study');
		await expect(page.getByTestId('ws-taken')).toBeVisible();
		await expect(page.getByTestId('ws-create')).toBeDisabled();
	});

	test('creates the workspace file and lands on its board', async ({ page }) => {
		await page.getByTestId('ws-name').fill('Riverside Clinic');
		await page.getByTestId('ws-folders').fill('Journal/Projects/Riverside Clinic');
		await page.getByTestId('ws-template').nth(1).check();
		await page.getByTestId('ws-create').click();

		await expect(page).toHaveURL(/\/w\/riverside-clinic$/);
		expect(await waitForFile('_hub/workspaces/riverside-clinic.md', (c) => c.includes('name: Riverside Clinic'))).toBe(
			true
		);
		const file = vaultFile('_hub/workspaces/riverside-clinic.md');
		expect(file).toContain('tag: ws/riverside-clinic');
		expect(file).toContain('template: business');
		expect(file).toContain('"Journal/Projects/Riverside Clinic"');

		await expect(page.getByTestId('workspace-name')).toHaveText('Riverside Clinic');
		await expect(page.locator('nav').first().getByRole('link', { name: 'Riverside Clinic' })).toBeVisible();
	});
});

test.describe('a board on a phone', () => {
	test.use({ viewport: { width: 412, height: 915 } });

	test('scrolls its columns sideways without the page overflowing', async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/w/atlas');
		await expect(page.getByTestId('column').first()).toBeVisible();
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(1);
	});
});
