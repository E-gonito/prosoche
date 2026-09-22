import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VAULT, vaultFile, waitForFile, resetVault } from './helpers';

// Notes open in reading view now, so every test about the editor asks for it
// by name. That the plain URL reads instead is covered in 15-notes-reading.
const NOTE = '/notes/Study/Algorithms.md?edit=1';

test.describe('the editor', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto(NOTE);
	});

	test('opens with the note loaded when the URL asks to edit', async ({ page }) => {
		await expect(page.locator('.cm-content')).toContainText('Algorithms');
		await expect(page.getByText('Saved')).toBeVisible();
	});

	test('hides markdown markers until the line is being edited', async ({ page }) => {
		const heading = page.locator('.cm-line.cm-h1').first();
		await expect(heading).toBeVisible();
		await expect(heading).toContainText('Algorithms');
		// Unfocused, the note reads as rendered.
		await expect(heading).not.toContainText('#');

		// Putting the cursor on that line reveals its source.
		await heading.click();
		await expect(heading).toContainText('# Algorithms');

		// Moving off it hides the marker again.
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await expect(heading).not.toContainText('#');
	});

	test('shows a wikilink as a link and navigates on click', async ({ page }) => {
		const link = page.locator('.cm-wikilink', { hasText: 'Handbook' });
		await expect(link).toBeVisible();
		await link.click();
		await expect(page).toHaveURL(/Handbook\.md$/);
	});

	test('typing saves the note by itself', async ({ page }) => {
		await page.locator('.cm-content').click();
		await page.keyboard.press('Control+End');
		await page.keyboard.type('\nA line typed by the test.');
		await expect(page.getByText('Unsaved changes')).toBeVisible();

		expect(await waitForFile('Study/Algorithms.md', (c) => c.includes('A line typed by the test.'))).toBe(true);
		await expect(page.getByText('Saved')).toBeVisible();
	});

	test('the bold button wraps the selection, and again to unwrap', async ({ page }) => {
		await page.locator('.cm-content').click();
		await page.keyboard.press('Control+End');
		await page.keyboard.type('\nplain');
		await page.keyboard.down('Shift');
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
		await page.keyboard.up('Shift');

		await page.getByRole('button', { name: /Bold/ }).click();
		expect(await waitForFile('Study/Algorithms.md', (c) => c.includes('**plain**'))).toBe(true);

		await page.getByRole('button', { name: /Bold/ }).click();
		expect(await waitForFile('Study/Algorithms.md', (c) => !c.includes('**plain**') && c.includes('plain'))).toBe(true);
	});

	test('Make card turns a selection into a question', async ({ page }) => {
		await page.locator('.cm-content').click();
		await page.keyboard.press('Control+End');
		await page.keyboard.type('\nWhat is a heap');
		await page.keyboard.down('Shift');
		for (let i = 0; i < 14; i++) await page.keyboard.press('ArrowLeft');
		await page.keyboard.up('Shift');

		await page.getByRole('button', { name: /Make card/ }).click();
		await page.keyboard.type('a tree with the heap property');
		expect(
			await waitForFile('Study/Algorithms.md', (c) => c.includes('What is a heap::a tree with the heap property'))
		).toBe(true);
	});

	test('Make cloze wraps a selection in highlight markers', async ({ page }) => {
		await page.locator('.cm-content').click();
		await page.keyboard.press('Control+End');
		await page.keyboard.type('\nthe pivot is chosen');
		await page.keyboard.down('Shift');
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
		await page.keyboard.up('Shift');

		await page.getByRole('button', { name: /Make cloze/ }).click();
		expect(await waitForFile('Study/Algorithms.md', (c) => c.includes('==hosen=='))).toBe(true);
	});

	test('a checkbox in the editor can be ticked', async ({ page }) => {
		const box = page.locator('.cm-task-box').first();
		await expect(box).toBeVisible();
		await box.click();
		expect(await waitForFile('Study/Algorithms.md', (c) => c.includes('- [x] Finish chapter 3'))).toBe(true);
	});

	test('wikilink completion suggests real notes', async ({ page }) => {
		await page.locator('.cm-content').click();
		await page.keyboard.press('Control+End');
		await page.keyboard.type('\nsee [[Hand');
		await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
		await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('Handbook');
	});

	test('an edit on another device becomes a conflict, not an overwrite', async ({ page }) => {
		await page.locator('.cm-content').click();
		await page.keyboard.press('Control+End');
		await page.keyboard.type('\nmy local edit');

		// Someone else saves the same note while we are typing.
		writeFileSync(join(VAULT, 'Study/Algorithms.md'), '# Algorithms\n\nrewritten elsewhere\n');

		await page.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(page.getByText('changed on another device')).toBeVisible();
		// Their version is still on disk; nothing was overwritten.
		expect(vaultFile('Study/Algorithms.md')).toContain('rewritten elsewhere');

		await page.getByRole('button', { name: 'Take theirs' }).click();
		await expect(page.locator('.cm-content')).toContainText('rewritten elsewhere');
	});

	test('keeping mine after a conflict overwrites deliberately', async ({ page }) => {
		await page.locator('.cm-content').click();
		await page.keyboard.press('Control+End');
		await page.keyboard.type('\nmine wins');
		writeFileSync(join(VAULT, 'Study/Algorithms.md'), '# Algorithms\n\ntheirs\n');

		await page.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(page.getByText('changed on another device')).toBeVisible();
		await page.getByRole('button', { name: 'Keep mine' }).click();
		expect(await waitForFile('Study/Algorithms.md', (c) => c.includes('mine wins'))).toBe(true);
	});

	test('the reading view renders markdown and marks an unresolved link', async ({ page }) => {
		await page.getByTestId('edit-toggle').click();
		await expect(page.locator('.prose h1')).toContainText('Algorithms');
		await expect(page.locator('.prose a', { hasText: 'Handbook' })).toBeVisible();
		await expect(page.locator('.prose .wl-missing')).toContainText('Nowhere At All');
	});

	test('the rail shows properties, tags and backlinks', async ({ page }) => {
		await page.goto('/notes/Work/Handbook.md');
		await expect(page.locator('.card', { hasText: 'Properties' })).toContainText('Acme');
		await expect(page.locator('.card', { hasText: 'Backlinks' })).toContainText('Algorithms');
	});

	test('the file tree navigates between notes', async ({ page }) => {
		await page.locator('.tree').getByRole('link', { name: 'Syllabus' }).click();
		await expect(page).toHaveURL(/Syllabus\.md$/);
		// The tree links to notes, not to the editor: the next one opens to read.
		await expect(page.locator('.prose')).toContainText('Checklist notation');
	});
});
