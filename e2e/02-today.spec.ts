import { test, expect } from '@playwright/test';
import { TODAY_NOTE, vaultFile, lineWith, dragTo, centre, minutes, waitForFile, resetVault } from './helpers';

test.describe('the day', () => {
	// Every test starts from the committed fixture, so none depends on another.
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/');
	});

	test('renders every time block from the note', async ({ page }) => {
		const blocks = page.getByTestId('block');
		await expect(blocks).toHaveCount(4);
		await expect(page.getByTestId('block').filter({ hasText: 'Morning stretch' })).toBeVisible();
		await expect(page.getByTestId('block').filter({ hasText: 'Client project' })).toContainText('10:40–18:00');
	});

	test('lays a nested block beside the one containing it', async ({ page }) => {
		// 14:00-14:30 "Read a book" sits inside 10:40-18:00 "Client project".
		const outer = page.getByTestId('block').filter({ hasText: 'Client project' });
		const inner = page.getByTestId('block').filter({ hasText: 'Read a book' });
		const a = await outer.boundingBox();
		const b = await inner.boundingBox();
		expect(a && b).toBeTruthy();
		// Side by side, not stacked on top of each other.
		expect(Math.abs(a!.x - b!.x)).toBeGreaterThan(20);
	});

	test('ticking a task writes exactly one character to the note', async ({ page }) => {
		const before = vaultFile(TODAY_NOTE).split('\n');
		const row = page.getByTestId('task-row').filter({ hasText: 'Twenty push ups' });
		await row.getByTestId('checkbox').click();

		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('- [x] Twenty push ups'))).toBe(true);
		const after = vaultFile(TODAY_NOTE).split('\n');
		const changed = after.map((l, i) => (l === before[i] ? null : i)).filter((i) => i !== null);
		expect(changed).toHaveLength(1);

		// Put it back, and confirm the file is identical again.
		await row.getByTestId('checkbox').click();
		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('- [ ] Twenty push ups'))).toBe(true);
		expect(vaultFile(TODAY_NOTE).split('\n')).toEqual(before);
	});

	test('dragging a block down moves it in the note, and nothing else', async ({ page }) => {
		const before = vaultFile(TODAY_NOTE).split('\n');
		const block = page.getByTestId('block').filter({ hasText: 'Read a book' });
		const from = await centre(page, '[data-testid="block"]:has-text("Read a book")');
		await dragTo(page, from, { x: from.x, y: from.y + minutes(60) });

		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('15:00 - 15:30 Read a book'))).toBe(true);
		await expect(block).toContainText('15:00–15:30');

		const after = vaultFile(TODAY_NOTE).split('\n');
		const changed = after.map((l, i) => (l === before[i] ? null : i)).filter((i) => i !== null);
		expect(changed).toHaveLength(1);
		expect(after[changed[0]!]).toBe('- [ ] 15:00 - 15:30 Read a book `Q2`');
	});

	test('resizing a block changes only its end time', async ({ page }) => {
		const box = await page.getByTestId('block').filter({ hasText: 'Read a book' }).boundingBox();
		await dragTo(
			page,
			{ x: box!.x + box!.width / 2, y: box!.y + box!.height - 2 },
			{ x: box!.x + box!.width / 2, y: box!.y + box!.height + minutes(30) }
		);
		// Baseline is 14:00-14:30; dragging the bottom edge down half an hour
		// moves only the end.
		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('14:00 - 15:00 Read a book'))).toBe(true);
	});

	test('arrow keys nudge a focused block', async ({ page }) => {
		const block = page.getByTestId('block').filter({ hasText: 'Read a book' });
		await block.focus();
		await block.press('ArrowUp');
		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('13:50 - 14:20 Read a book'))).toBe(true);
		// Two more in quick succession, which must both land rather than the
		// second being refused for carrying a line the server already replaced.
		await block.press('ArrowDown');
		await block.press('ArrowDown');
		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('14:10 - 14:40 Read a book'))).toBe(true);
	});

	test('Backspace on a focused block unschedules it', async ({ page }) => {
		const block = page.getByTestId('block').filter({ hasText: 'Read a book' });
		await block.focus();
		await block.press('Backspace');
		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('- [ ] Read a book `Q2`'))).toBe(true);
	});

	test('dragging an unscheduled task onto the timeline gives it a time', async ({ page }) => {
		const row = page.getByTestId('task-row').filter({ hasText: 'Walk the dog' });
		await expect(row).toBeVisible();
		const grip = await centre(page, '[data-testid="task-row"]:has-text("Walk the dog") [data-testid="grip"]');
		const timeline = await page.getByTestId('timeline').boundingBox();

		// Drop roughly a third of the way down the grid.
		await dragTo(page, grip, { x: timeline!.x + timeline!.width / 2, y: timeline!.y + timeline!.height / 3 });

		expect(await waitForFile(TODAY_NOTE, (c) => /- \[ \] \d\d:\d0 - \d\d:\d0 Walk the dog/.test(c))).toBe(true);
		const { text } = lineWith(TODAY_NOTE, 'Walk the dog');
		expect(text).toMatch(/^- \[ \] \d\d:\d0 - \d\d:\d0 Walk the dog, refill the water `Q1`$/);
		await expect(page.getByTestId('block').filter({ hasText: 'Walk the dog' })).toBeVisible();
	});

	test('dragging a block onto the unscheduled card takes its time off', async ({ page }) => {
		const from = await centre(page, '[data-testid="block"]:has-text("Read a book")');
		const target = await page.getByTestId('unscheduled').boundingBox();
		await dragTo(page, from, { x: target!.x + target!.width / 2, y: target!.y + 30 });

		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('- [ ] Read a book `Q2`'))).toBe(true);
		await expect(page.getByTestId('task-row').filter({ hasText: 'Read a book' })).toBeVisible();
	});

	test('the clear button on a block also unschedules it', async ({ page }) => {
		const block = page.getByTestId('block').filter({ hasText: 'Read a book' });
		await block.hover();
		await block.getByTestId('clear-time').click();
		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('- [ ] Read a book `Q2`'))).toBe(true);
		await expect(page.getByTestId('task-row').filter({ hasText: 'Read a book' })).toBeVisible();
	});

	test('the fenced backlog is shown but not editable', async ({ page }) => {
		const backlog = page.locator('.card', { has: page.getByText('Backlog', { exact: false }) }).last();
		await expect(backlog).toContainText('Driving licence');
		// No checkbox to click, because Obsidian treats these as text.
		await expect(backlog.getByTestId('checkbox')).toHaveCount(0);
	});

	test('the workspace panel shows a real task and counts what it excluded', async ({ page }) => {
		const panel = page.locator('.card', { hasText: 'From your workspaces' });
		await expect(panel).toContainText('Finish chapter 3');
		await expect(panel).toContainText('Study');
		// Syllabus.md has two quadrant-less checkboxes, which are not tasks.
		await expect(panel).not.toContainText('Indexing');
	});

	test('quick capture appends to the inbox', async ({ page }) => {
		await page.getByLabel('Quick capture').fill('remember the milk');
		await page.getByRole('button', { name: 'Add' }).click();
		expect(await waitForFile('Inbox/Capture.md', (c) => c.includes('remember the milk'))).toBe(true);
		expect(vaultFile('Inbox/Capture.md')).toMatch(/## \d{4}-\d{2}-\d{2}\n- \d\d:\d\d remember the milk/);
	});

	test('a day with no note offers to create one from the template', async ({ page }) => {
		await page.goto('/day/2026-12-25');
		await expect(page.getByText('No note for this day yet')).toBeVisible();
		await page.getByRole('button', { name: /Create it from your template/ }).click();
		expect(await waitForFile('Journal/2026/12/25.md', (c) => c.includes('Morning stretch'))).toBe(true);
		// Copied verbatim, quirks included.
		expect(vaultFile('Journal/2026/12/25.md')).toBe(vaultFile('Journal/Journal Template.md'));
		await expect(page.getByTestId('task-row').first()).toBeVisible();
	});

	test('day navigation moves a day at a time', async ({ page }) => {
		await page.goto('/day/2026-09-21');
		await page.getByRole('link', { name: 'Next day' }).click();
		await expect(page).toHaveURL(/2026-09-22/);
		await page.getByRole('link', { name: 'Previous day' }).click();
		await expect(page).toHaveURL(/2026-09-21/);
	});
});
