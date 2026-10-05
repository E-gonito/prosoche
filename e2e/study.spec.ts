import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { lineWith, resetVault, TODAY, VAULT, vaultFile, waitForFile } from './helpers';

/**
 * Study, against `fixtures/study.mjs`: one subject, the base vault's `study`
 * workspace, homed at `Study/`, so its pages are under `/study/study`.
 */

const BASE = '/study/study';
const GOALS = 'Study/Goals.md';
const READING = 'Study/Reading List.md';
const AWS = 'Pass AWS Solutions Architect';
const PAPERS = 'Read three papers a month';

/** `YYYY-MM-DD`, `offset` days from `from`. */
function shift(from: string, offset: number): string {
	const at = new Date(`${from}T00:00:00Z`);
	at.setUTCDate(at.getUTCDate() + offset);
	return at.toISOString().slice(0, 10);
}

const item = (page: Page, title: string) => page.getByTestId('reading-item').filter({ hasText: title });

test.describe('Study index', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/study');
	});

	test('shows each subject with its goals', async ({ page }) => {
		const subject = page.getByTestId('subject-card');
		await expect(subject).toHaveCount(1);
		await expect(subject).toContainText(AWS);
		await expect(subject).toContainText('1/2');
		await expect(page.getByTestId('sub-study')).toContainText('Study');
	});

	test('New subject writes a subject file homed at Study/<name> and opens it', async ({ page }) => {
		await page.getByTestId('subject-name').fill('Filipino');
		await page.getByTestId('subject-folders').fill('Languages/Filipino');
		await page.getByTestId('create-subject').click();

		await expect(page).toHaveURL('/study/filipino');
		const file = vaultFile('_hub/subjects/filipino.md');
		expect(file).toContain('\nfolders:\n  - "Study/Filipino"\n  - "Languages/Filipino"\n');
		expect(vaultFile('_hub/workspaces/filipino.md')).toBe('');
		// Every tab shows, even for a subject with nothing in it yet.
		await expect(page.getByTestId('study-tabs').getByRole('link')).toHaveText(['Overview', 'Notes', 'Goals', 'Reading list']);
	});


	test('an old single-subject address opens that tab of the only subject', async ({ page }) => {
		await page.goto('/study/resources');
		await expect(page).toHaveURL(`${BASE}/reading`);
		await page.goto('/study/goals');
		await expect(page).toHaveURL(`${BASE}/goals`);
		await page.goto('/study/sessions');
		await expect(page).toHaveURL(BASE);
	});
});

test.describe('Subject overview', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto(BASE);
	});


	test('shows one goal, the first unfinished, as the step to do now and the steps in order', async ({ page }) => {
		const focus = page.getByTestId('focus');
		await expect(page.getByTestId('goal-pill')).toHaveCount(2);
		await expect(page.getByTestId('goal-pill').first()).toHaveAttribute('aria-current', 'true');
		await expect(focus.getByRole('heading')).toHaveText(AWS);
		await expect(focus).not.toContainText(PAPERS);
		await expect(focus.getByTestId('focus-progress')).toHaveText('1 of 2 steps done');
		await expect(focus.getByTestId('step-now')).toContainText('step 2 of 2');
		await expect(focus.getByTestId('step-now')).toContainText('Two practice exams');
		await expect(focus.getByTestId('focus-resources')).toContainText('AWS whitepapers');
		await expect(focus.getByTestId('step')).toHaveText([/Finish the networking module/, /Two practice exams/]);
	});

	test('Done ticks the step now, and finishing the goal moves on to the next unfinished one', async ({ page }) => {
		const before = vaultFile(GOALS);
		const { index } = lineWith(GOALS, 'Two practice exams');
		await page.getByTestId('step-done').click();

		await expect(page.getByTestId('focus').getByRole('heading')).toHaveText(PAPERS);
		await expect(page.getByTestId('step-now')).toContainText('Paper one');
		expect(vaultFile(GOALS)).toBe(before.split('\n').map((l, i) => (i === index ? '- [x] Two practice exams 📅 2026-11-20' : l)).join('\n'));
	});

	test('a goal picked and finished says so, and offers the next', async ({ page }) => {
		await page.getByTestId('goal-pill').filter({ hasText: PAPERS }).click();
		await expect(page.getByTestId('step-now')).toContainText('Paper one');
		await page.getByTestId('step-done').click();
		await expect(page.getByTestId('step-now')).toContainText('Paper two');
		await page.getByTestId('step-done').click();

		await expect(page.getByTestId('goal-finished')).toContainText('Every step of this goal is done.');
		await page.getByTestId('next-goal').click();
		await expect(page.getByTestId('focus').getByRole('heading')).toHaveText(AWS);
		expect(vaultFile(GOALS)).toContain('---\nweekly_hours: 6\nfocus: Pass AWS Solutions Architect\n---\n');
	});

	test('picking a goal makes it the focus, adding only its focus: line', async ({ page }) => {
		const before = vaultFile(GOALS);
		await page.getByTestId('goal-pill').filter({ hasText: PAPERS }).click();

		await expect(page.getByTestId('focus').getByRole('heading')).toHaveText(PAPERS);
		await expect(page.getByTestId('goal-pill').nth(1)).toHaveAttribute('aria-current', 'true');
		expect(vaultFile(GOALS)).toBe(before.replace('weekly_hours: 6\n', 'weekly_hours: 6\nfocus: Read three papers a month\n'));

		// Still the focus on the next visit.
		await page.reload();
		await expect(page.getByTestId('focus').getByRole('heading')).toHaveText(PAPERS);
	});

	test('a goal not in focus shows when its next step is due within the week', async ({ page }) => {
		writeFileSync(`${VAULT}/${GOALS}`, vaultFile(GOALS).replace('- [ ] Paper one', `- [ ] Paper one 📅 ${shift(TODAY, -1)}`));
		await page.reload();
		const due = page.getByTestId('goal-pill').filter({ hasText: PAPERS }).getByTestId('goal-due');
		await expect(due).toHaveText('Yesterday');
		await expect(due).toHaveClass(/late/);
		await expect(page.getByTestId('goal-pill').filter({ hasText: AWS }).getByTestId('goal-due')).toHaveCount(0);
	});

	test('principles: a missing Principles.md offers to be written, and the first save creates it in the home', async ({ page }) => {
		const note = page.getByTestId('principles');
		await expect(note).toContainText('No principles yet');
		await note.getByTestId('master-note-edit').click();
		await note.getByTestId('master-note-text').fill('1. **Build it from scratch.**\n');
		await note.getByTestId('master-note-save').click();
		await expect(note.locator('.prose strong')).toHaveText('Build it from scratch.');
		expect(vaultFile('Study/Principles.md')).toBe('1. **Build it from scratch.**\n');
	});
});

test.describe('Today', () => {
	test('shows the step to do now in a Study next card that opens the subject', async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/today');
		const card = page.locator('[data-testid="module-card"][data-module="study"]');
		await expect(card).toContainText('Study next');
		await expect(card).toContainText('Two practice exams');
		await expect(card).toContainText(`${AWS} · step 2 of 2`);
		await card.getByRole('link', { name: /Two practice exams/ }).click();
		await expect(page).toHaveURL(BASE);
		await expect(page.getByTestId('step-now')).toContainText('Two practice exams');
	});
});

test.describe('Goals', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto(`${BASE}/goals`);
	});

	test('ticking a milestone changes exactly that line', async ({ page }) => {
		const before = vaultFile(GOALS).split('\n');
		const { index } = lineWith(GOALS, 'Two practice exams');

		await page.getByTestId('milestone').filter({ hasText: 'Two practice exams' }).locator('input').click();

		expect(await waitForFile(GOALS, (c) => c.split('\n')[index] === '- [x] Two practice exams 📅 2026-11-20')).toBe(true);
		const after = vaultFile(GOALS).split('\n');
		const changed = after.map((l, i) => (l === before[i] ? null : i)).filter((i) => i !== null);
		expect(changed).toEqual([index]);
	});

	test('adding a goal appends a new heading', async ({ page }) => {
		await page.getByTestId('goal-title').fill('Learn Rust');
		await page.getByTestId('goal-target').fill('2027-01-01');
		await page.getByTestId('add-goal').click();

		expect(await waitForFile(GOALS, (c) => c.includes('## Learn Rust'))).toBe(true);
		expect(vaultFile(GOALS)).toContain('## Learn Rust\ntarget:: 2027-01-01\n');
		await expect(page.getByTestId('goal').filter({ hasText: 'Learn Rust' })).toBeVisible();
	});

	test('adding a milestone appends it under its goal', async ({ page }) => {
		await page.getByTestId('milestone-goal').selectOption(PAPERS);
		await page.getByTestId('milestone-text').fill('Paper three');
		await page.getByTestId('add-milestone').click();

		expect(await waitForFile(GOALS, (c) => c.includes('- [ ] Paper three'))).toBe(true);
		const lines = vaultFile(GOALS).split('\n');
		const at = lines.indexOf('- [ ] Paper three');
		expect(lines[at - 1]).toBe('- [ ] Paper two');
	});
});

test.describe('Reading list', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto(`${BASE}/reading`);
	});

	test('shows the file’s columns as groups, with each item’s kind and goal', async ({ page }) => {
		await expect(page.getByTestId('reading-group')).toHaveCount(2);
		await expect(item(page, 'Pointers explained')).toContainText('video');
		await expect(item(page, 'AWS whitepapers')).toContainText(AWS);
		await expect(item(page, 'AWS whitepapers').getByRole('link')).toHaveAttribute('href', 'https://aws.amazon.com/whitepapers');
	});

	test('adding an item writes one card line into its group', async ({ page }) => {
		const before = vaultFile(READING);
		await page.getByTestId('add-title').fill('CS:APP');
		await page.getByTestId('add-url').fill('https://csapp.cs.cmu.edu');
		await page.getByTestId('add-kind').selectOption('book');
		await page.getByTestId('add-goal').selectOption(PAPERS);
		await page.getByTestId('add-group').selectOption({ label: 'Paused' });
		await page.getByTestId('add-item').click();

		const line = `- [ ] [CS:APP](https://csapp.cs.cmu.edu) [[Goals#${PAPERS}]] #book`;
		expect(await waitForFile(READING, (c) => c.includes(line))).toBe(true);
		expect(vaultFile(READING)).toBe(before.replace('## Paused\n\n', `## Paused\n\n${line}\n`));
		await expect(item(page, 'CS:APP')).toBeVisible();
	});

	test('editing an item’s kind and goal rewrites only its line', async ({ page }) => {
		const before = vaultFile(READING);
		await item(page, 'The Pragmatic Programmer').getByTestId('item-menu').click();
		await page.getByTestId('item-edit').click();
		const form = page.getByTestId('reading-edit');
		await form.getByTestId('edit-kind').selectOption('course');
		await form.getByTestId('edit-goal').selectOption(AWS);
		await form.getByTestId('edit-save').click();

		const line = `- [ ] The Pragmatic Programmer [[Goals#${AWS}]] #course`;
		expect(await waitForFile(READING, (c) => c.includes(line))).toBe(true);
		expect(vaultFile(READING)).toBe(before.replace('- [ ] The Pragmatic Programmer #book', line));
	});

	test('moving an item to Done ticks it, and Move up reorders a group', async ({ page }) => {
		await item(page, 'Pointers explained').getByTestId('item-status').selectOption({ label: 'Done' });
		expect(await waitForFile(READING, (c) => c.includes('**Complete**\n- [x] [Pointers explained]'))).toBe(true);

		await page.getByTestId('add-title').fill('Second');
		await page.getByTestId('add-item').click();
		await expect(item(page, 'Second')).toBeVisible();
		await item(page, 'Second').getByTestId('item-menu').click();
		await page.getByTestId('item-up').click();
		// Book is the add form's first kind.
		expect(await waitForFile(READING, (c) => c.includes('## To read\n\n- [ ] Second #book\n- [ ] The Pragmatic Programmer #book\n'))).toBe(true);
	});

	test('deleting an item asks twice and removes only its line', async ({ page }) => {
		const before = vaultFile(READING);
		await item(page, 'The Pragmatic Programmer').getByTestId('item-menu').click();
		await page.getByTestId('item-delete').click();
		await page.getByTestId('delete-confirm').click();
		expect(await waitForFile(READING, (c) => c === before.replace('- [ ] The Pragmatic Programmer #book\n', ''))).toBe(true);
	});
});

test.describe('Phone layout', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('Study is reached from the More sheet', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/notes');

		await page.getByTestId('tab-more').click();
		// The workspace fixture is also called "Study", so the module link is
		// found by its href rather than by its (ambiguous) accessible name.
		await page.locator('dialog.more a[href="/study"]').click();
		await expect(page).toHaveURL('/study');
		await expect(page.getByTestId('subject-card')).toBeVisible();
	});

	test('a subject’s Overview puts the step to do now on the first screen, with room to tap', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(BASE);

		const done = page.getByTestId('step-done');
		await expect(done).toBeInViewport();
		expect((await done.boundingBox())!.height).toBeGreaterThanOrEqual(40);
		// The goals row scrolls on its own; the page never scrolls sideways.
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	});
});

test.describe('A subject’s Notes tab', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('lists the folders its notes come from, to edit', async ({ page }) => {
		await page.goto('/study/study/notes');
		await expect(page.getByTestId('folder-chips')).toContainText('Study/');
	});

	test('browses the subject’s folders and reads a note in place', async ({ page }) => {
		await page.goto('/study/study/notes');
		const tree = page.getByTestId('subject-tree');
		await expect(tree).toContainText('Study');
		await tree.getByRole('link', { name: 'Algorithms' }).click();
		await expect(page).toHaveURL(/\/study\/study\/notes\?note=Study%2FAlgorithms\.md$/);
		await expect(page.getByTestId('subject-note-body')).toBeVisible();

		await page.getByTestId('subject-notes-filter').fill('syllab');
		await expect(tree.getByRole('link')).toHaveCount(1);
		await expect(tree.getByRole('link')).toContainText('Syllabus');
	});

	test('will not open a note from outside the subject', async ({ page }) => {
		await page.goto(`/study/study/notes?note=${encodeURIComponent('Work/Tasks.md')}`);
		await expect(page.getByTestId('subject-note-body')).toHaveCount(0);
		await expect(page.locator('.reader')).toContainText('not in Study');
	});
});
