import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VAULT, vaultFile, resetVault } from './helpers';

const UNDO = '/tmp/prosoche-e2e/undo';
const git = (...args: string[]) => execFileSync('git', ['-C', VAULT, ...args], { encoding: 'utf8' });

test.describe('sync', () => {
	test.beforeEach(async ({ request }) => await resetVault(request));

	test('reports a clean vault as having nothing to commit', async ({ page }) => {
		await page.goto('/sync');
		await expect(page.getByText('Nothing to commit')).toBeVisible();
	});

	test('lists local changes and shows a diff for one', async ({ page }) => {
		writeFileSync(join(VAULT, 'Study/Algorithms.md'), '# Algorithms\n\nchanged by the test\n');
		writeFileSync(join(VAULT, 'Inbox/scratch.md'), '# Scratch\n');
		await page.goto('/sync');

		await expect(page.locator('.pick')).toContainText('Study/Algorithms.md');
		await expect(page.locator('.pick')).toContainText('Inbox/scratch.md');
		await expect(page.locator('.row', { hasText: 'Inbox/scratch.md' })).toContainText('new');

		await page.locator('.row', { hasText: 'Study/Algorithms.md' }).getByRole('button', { name: 'diff' }).click();
		await expect(page.locator('.diff')).toContainText('changed by the test');
	});

	test('commits only the files that are ticked', async ({ page }) => {
		writeFileSync(join(VAULT, 'Study/Algorithms.md'), '# Algorithms\n\ncommit me\n');
		writeFileSync(join(VAULT, 'Inbox/scratch.md'), '# Leave me alone\n');
		await page.goto('/sync');

		await page.locator('.row', { hasText: 'Study/Algorithms.md' }).getByRole('checkbox').check();
		await page.getByLabel('Commit message').fill('test: only the algorithms note');
		await page.getByRole('button', { name: /Commit and push/ }).click();

		// The modal names what it is about to do.
		const dialog = page.getByRole('dialog');
		await expect(dialog).toContainText('Study/Algorithms.md');
		await expect(dialog).not.toContainText('Inbox/scratch.md');
		await dialog.getByRole('button', { name: 'Commit and push' }).click();

		await expect(page.getByText(/Committed and pushed 1 file/)).toBeVisible();
		expect(git('log', '--oneline', '-1')).toContain('only the algorithms note');
		expect(git('show', '--stat', '--format=', 'HEAD')).toContain('Study/Algorithms.md');
		// The other file is still waiting.
		expect(git('status', '--porcelain')).toContain('Inbox/scratch.md');
	});

	test('cancelling the discard dialog changes nothing', async ({ page }) => {
		writeFileSync(join(VAULT, 'Study/Algorithms.md'), '# Algorithms\n\nstill here afterwards\n');
		await page.goto('/sync');
		await page.locator('.row', { hasText: 'Study/Algorithms.md' }).getByRole('checkbox').check();
		await page.getByRole('button', { name: /Discard/ }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toContainText('cannot be undone');
		await dialog.getByRole('button', { name: 'Cancel' }).click();

		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(vaultFile('Study/Algorithms.md')).toContain('still here afterwards');
	});

	test('Escape also cancels, so a stray keypress cannot discard', async ({ page }) => {
		writeFileSync(join(VAULT, 'Study/Algorithms.md'), '# Algorithms\n\nsurvives escape\n');
		await page.goto('/sync');
		await page.locator('.row', { hasText: 'Study/Algorithms.md' }).getByRole('checkbox').check();
		await page.getByRole('button', { name: /Discard/ }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(vaultFile('Study/Algorithms.md')).toContain('survives escape');
	});

	test('confirming a discard reverts the file and leaves a snapshot', async ({ page }) => {
		writeFileSync(join(VAULT, 'Study/Algorithms.md'), '# Algorithms\n\nthrow this away\n');
		await page.goto('/sync');
		await page.locator('.row', { hasText: 'Study/Algorithms.md' }).getByRole('checkbox').check();
		await page.getByRole('button', { name: /Discard/ }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Discard them' }).click();

		await expect(page.getByText(/Discarded 1 file/)).toBeVisible();
		expect(vaultFile('Study/Algorithms.md')).not.toContain('throw this away');
		expect(vaultFile('Study/Algorithms.md')).toContain('Finish chapter 3');

		// What was thrown away is still readable.
		const snapshots = readdirSync(UNDO).filter((d) => d.startsWith('discard-'));
		expect(snapshots.length).toBeGreaterThan(0);
		const saved = snapshots
			.map((d) => join(UNDO, d, 'Study/Algorithms.md'))
			.filter((p) => existsSync(p));
		expect(saved.length).toBeGreaterThan(0);
	});

	test('discarding an untracked file removes it', async ({ page }) => {
		writeFileSync(join(VAULT, 'Inbox/delete-me.md'), '# Delete me\n');
		await page.goto('/sync');
		await page.locator('.row', { hasText: 'Inbox/delete-me.md' }).getByRole('checkbox').check();
		await page.getByRole('button', { name: /Discard/ }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Discard them' }).click();

		await expect(page.getByText(/Discarded 1 file/)).toBeVisible();
		expect(existsSync(join(VAULT, 'Inbox/delete-me.md'))).toBe(false);
	});

	test('select all ticks everything, and the buttons are dead with nothing chosen', async ({ page }) => {
		writeFileSync(join(VAULT, 'Inbox/a.md'), 'a\n');
		writeFileSync(join(VAULT, 'Inbox/b.md'), 'b\n');
		await page.goto('/sync');

		await expect(page.getByRole('button', { name: /^Commit and push/ })).toBeDisabled();
		await expect(page.getByRole('button', { name: /^Discard/ })).toBeDisabled();

		await page.getByText('Select all').click();
		await expect(page.getByRole('button', { name: /^Commit and push 2/ })).toBeEnabled();
		await page.getByText('Deselect all').click();
		await expect(page.getByRole('button', { name: /^Commit and push/ })).toBeDisabled();
	});

	test('rebuilding the index reports how long it took', async ({ page }) => {
		await page.goto('/sync');
		await page.getByRole('button', { name: 'Rebuild index' }).click();
		await expect(page.getByText(/Index rebuilt in \d+ ms/)).toBeVisible();
	});

	test('the index panel counts what it holds', async ({ page }) => {
		await page.goto('/sync');
		const panel = page.locator('.card', { hasText: 'Index' }).first();
		await expect(panel).toContainText('notes');
		await expect(panel).not.toContainText('undefined');
	});

	test('pulling from the remote works and is reported', async ({ page }) => {
		await page.goto('/sync');
		await page.getByRole('button', { name: 'Pull' }).click();
		await expect(page.getByText('pull finished')).toBeVisible();
		await expect(page.locator('.card', { hasText: 'Git' })).not.toContainText('no tracking information');
	});
});
