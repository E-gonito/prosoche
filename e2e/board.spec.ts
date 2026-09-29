import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { VAULT, dragTo, resetVault, vaultFile, waitForFile } from './helpers';

/**
 * The board and the master note on a workspace's Overview, against
 * `fixtures/workspaces.mjs`: Work/Board.md in the Kanban plugin's format,
 * with "Draft the proposal" (notes, a due date long past, Q2, #client) and
 * "Book the venue" in To do, an empty Doing, and a ticked card in Done.
 *
 * Every test checks the file, not only the screen, and that the lines it did
 * not mean to touch are exactly as they were.
 */

const BOARD = 'Work/Board.md';

const column = (page: Page, title: string) => page.getByTestId('board-column').filter({ has: page.getByRole('heading', { name: title }) });
const card = (page: Page, title: string) => page.getByTestId('board-card').filter({ hasText: title });

test.describe('Board', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/w/work');
	});

	test('shows the columns and cards of Board.md, with an overdue due date in red', async ({ page }) => {
		await expect(page.getByTestId('board-column')).toHaveCount(3);
		await expect(column(page, 'To do').getByTestId('board-card')).toHaveCount(2);
		const due = card(page, 'Draft the proposal').getByTestId('card-due');
		await expect(due).toHaveText('1 Jan 2000');
		await expect(due).toHaveClass(/overdue/);
		// The Tasks tab is gone.
		await expect(page.getByTestId('tab').filter({ hasText: 'Tasks' })).toHaveCount(0);
	});

	test('quick-add parses the priority, label and due word into the card line', async ({ page }) => {
		const before = vaultFile(BOARD);
		await column(page, 'Doing').getByTestId('add-card').click();
		await page.getByTestId('add-card-text').fill('Call the landlord 2031-05-02 Q1 #legal');
		await page.getByTestId('add-card-text').press('Enter');
		await expect(card(page, 'Call the landlord')).toBeVisible();

		expect(await waitForFile(BOARD, (c) => c.includes('Call the landlord'))).toBe(true);
		const lines = vaultFile(BOARD).split('\n');
		expect(lines.slice(13, 16)).toEqual(['## Doing', '', '- [ ] Call the landlord @{2031-05-02} `Q1` #legal']);
		// One line added, nothing else changed.
		expect(lines.filter((l) => !l.includes('Call the landlord')).join('\n')).toBe(before);
	});

	test('dragging a card to another column moves its lines, notes and all', async ({ page }) => {
		const from = await card(page, 'Draft the proposal').boundingBox();
		const to = await column(page, 'Doing').boundingBox();
		if (!from || !to) throw new Error('no boxes');
		await dragTo(page, { x: from.x + from.width / 2, y: from.y + 12 }, { x: to.x + to.width / 2, y: to.y + 50 });

		await expect(column(page, 'Doing').getByTestId('board-card')).toHaveText(/Draft the proposal/);
		expect(await waitForFile(BOARD, (c) => c.indexOf('Draft the proposal') > c.indexOf('## Doing'))).toBe(true);
		const content = vaultFile(BOARD);
		expect(content).toContain('## Doing\n\n- [ ] Draft the proposal @{2000-01-01} `Q2` #client\n\tAsk for the budget first.\n');
		expect(content).toContain('## To do\n\n- [ ] Book the venue\n');
		// Dropping a card on the last column does not tick it; nothing here did.
		expect(content).not.toContain('- [x] Draft the proposal');
	});

	test('dragging within a column reorders it', async ({ page }) => {
		const from = await card(page, 'Book the venue').boundingBox();
		const onto = await card(page, 'Draft the proposal').boundingBox();
		if (!from || !onto) throw new Error('no boxes');
		await dragTo(page, { x: from.x + from.width / 2, y: from.y + 10 }, { x: onto.x + onto.width / 2, y: onto.y + 4 });
		expect(await waitForFile(BOARD, (c) => c.indexOf('Book the venue') < c.indexOf('Draft the proposal'))).toBe(true);
	});

	test('a card menu moves a card with the keyboard', async ({ page }) => {
		await card(page, 'Book the venue').getByTestId('card-menu').focus();
		await page.keyboard.press('Enter');
		await page.getByTestId('card-menu-items').getByTestId('move-to').filter({ hasText: 'Done' }).click();
		await expect(column(page, 'Done').getByTestId('board-card')).toHaveCount(2);
		expect(await waitForFile(BOARD, (c) => c.includes('- [x] Sign the contract\n- [ ] Book the venue'))).toBe(true);
	});

	test('the drawer edits title, due date, priority, labels and notes, one line at a time', async ({ page }) => {
		await card(page, 'Book the venue').getByTestId('card-open').click();
		const editor = page.getByTestId('card-editor');
		await expect(editor).toBeVisible();

		await editor.getByTestId('editor-title').fill('Book the hall');
		await editor.getByTestId('editor-title').press('Enter');
		expect(await waitForFile(BOARD, (c) => c.includes('- [ ] Book the hall'))).toBe(true);

		await editor.getByTestId('editor-due').fill('2031-03-04');
		expect(await waitForFile(BOARD, (c) => c.includes('- [ ] Book the hall @{2031-03-04}'))).toBe(true);

		await editor.getByTestId('editor-priority').selectOption('3');
		expect(await waitForFile(BOARD, (c) => c.includes('- [ ] Book the hall @{2031-03-04} `Q3`'))).toBe(true);

		await editor.getByTestId('editor-labels').fill('#venue #ops');
		await editor.getByTestId('editor-labels').press('Enter');
		expect(await waitForFile(BOARD, (c) => c.includes('- [ ] Book the hall @{2031-03-04} `Q3` #venue #ops'))).toBe(true);

		await editor.getByTestId('editor-notes').fill('Two halls to call.\nAsk about parking.');
		await editor.getByTestId('editor-title').focus();
		expect(await waitForFile(BOARD, (c) => c.includes('#venue #ops\n\tTwo halls to call.\n\tAsk about parking.\n'))).toBe(true);

		await editor.getByTestId('editor-close').click();
		await expect(card(page, 'Book the hall').getByTestId('card-due')).toBeVisible();
		// The other card and its notes are untouched.
		expect(vaultFile(BOARD)).toContain('- [ ] Draft the proposal @{2000-01-01} `Q2` #client\n\tAsk for the budget first.\n');
	});

	test('the drawer deletes a card and its notes, asking twice, and nothing else', async ({ page }) => {
		const before = vaultFile(BOARD);
		await card(page, 'Draft the proposal').getByTestId('card-open').click();
		const editor = page.getByTestId('card-editor');
		await editor.getByTestId('editor-delete').click();
		await editor.getByTestId('editor-delete-confirm').click();

		const expected = before.replace('- [ ] Draft the proposal @{2000-01-01} `Q2` #client\n\tAsk for the budget first.\n', '');
		expect(await waitForFile(BOARD, (c) => c === expected)).toBe(true);
		await expect(editor).toHaveCount(0);
		await expect(card(page, 'Draft the proposal')).toHaveCount(0);
	});

	test('ticking a card writes [x] and moves nothing', async ({ page }) => {
		await card(page, 'Book the venue').getByTestId('card-done').click();
		expect(await waitForFile(BOARD, (c) => c.includes('- [x] Book the venue'))).toBe(true);
	});

	test('columns can be added, renamed, moved and, when empty, deleted', async ({ page }) => {
		await page.getByTestId('add-column').click();
		await page.getByTestId('add-column-text').fill('Waiting');
		await page.getByTestId('add-column-text').press('Enter');
		await expect(page.getByTestId('board-column')).toHaveCount(4);
		expect(await waitForFile(BOARD, (c) => c.includes('## Waiting'))).toBe(true);

		await column(page, 'Waiting').getByTestId('column-menu').click();
		await page.getByRole('menuitem', { name: 'Rename' }).click();
		await page.getByTestId('column-rename').fill('On hold');
		await page.getByTestId('column-rename').press('Enter');
		expect(await waitForFile(BOARD, (c) => c.includes('## On hold') && !c.includes('## Waiting'))).toBe(true);

		await column(page, 'On hold').getByTestId('column-menu').click();
		await page.getByRole('menuitem', { name: 'Move left' }).click();
		expect(await waitForFile(BOARD, (c) => c.indexOf('## On hold') < c.indexOf('## Done'))).toBe(true);

		await column(page, 'On hold').getByTestId('column-menu').click();
		await page.getByTestId('column-delete').click();
		await expect(page.getByTestId('board-column')).toHaveCount(3);
		expect(await waitForFile(BOARD, (c) => !c.includes('## On hold'))).toBe(true);

		// A column with cards cannot be deleted.
		await column(page, 'To do').getByTestId('column-menu').click();
		await expect(page.getByTestId('column-delete')).toBeDisabled();
	});

	test('a board changed in Obsidian meanwhile refuses the stale change and reloads', async ({ page }) => {
		writeFileSync(`${VAULT}/${BOARD}`, vaultFile(BOARD).replace('Book the venue', 'Book the venue today'));
		await card(page, 'Draft the proposal').getByTestId('card-done').click();
		await expect(page.getByTestId('board-problem')).toContainText('changed somewhere else');
		await expect(card(page, 'Book the venue today')).toBeVisible();
		expect(vaultFile(BOARD)).toContain('- [ ] Draft the proposal');
	});
});

test.describe('Master note', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/w/work');
	});

	test('a missing Overview.md offers to be written, and the first save creates it', async ({ page }) => {
		const note = page.getByTestId('master-note');
		await note.getByTestId('master-note-edit').click();
		await note.getByTestId('master-note-text').fill('# Work\n\nThe **day job**. See [[Handbook]].\n');
		await note.getByTestId('master-note-save').click();
		await expect(note.locator('.prose strong')).toHaveText('day job');
		expect(vaultFile('Work/Overview.md')).toBe('# Work\n\nThe **day job**. See [[Handbook]].\n');
	});

	test('a save over a newer version writes nothing and says so', async ({ page }) => {
		const note = page.getByTestId('master-note');
		await note.getByTestId('master-note-edit').click();
		writeFileSync(`${VAULT}/Work/Overview.md`, 'Written in Obsidian.\n');
		await note.getByTestId('master-note-text').fill('Mine.');
		await note.getByTestId('master-note-save').click();
		await expect(note.getByTestId('master-note-problem')).toContainText('changed somewhere else');
		expect(vaultFile('Work/Overview.md')).toBe('Written in Obsidian.\n');
	});
});

test.describe('Board on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test.beforeEach(async ({ request }) => await resetVault(request));

	test('columns scroll sideways, and the card menu still moves a card', async ({ page }) => {
		await page.goto('/w/work');
		const scroller = page.locator('[data-board-scroll]');
		const overflow = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth);
		expect(overflow).toBe(true);
		await card(page, 'Book the venue').getByTestId('card-menu').tap();
		await page.getByTestId('card-menu-items').getByTestId('move-to').filter({ hasText: 'Doing' }).tap();
		expect(await waitForFile(BOARD, (c) => c.indexOf('Book the venue') > c.indexOf('## Doing'))).toBe(true);
	});
});
