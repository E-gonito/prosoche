import { test, expect } from '@playwright/test';
import { resetVault, vaultFile } from './helpers';

/** The day before today, as the Meetings fixture computes it. */
const PAST = (() => {
	const now = new Date();
	const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
})();

/*
 * The glossary fixture is Work's, from `fixtures/meetings.mjs`: DVC looked
 * up, MLflow waiting, and Cookie Cutter captured in a past meeting but not
 * yet added. Study has no Glossary.md.
 */
test.describe('Glossary', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('lists each glossary with its size, and starts one for a workspace without', async ({ page }) => {
		await page.goto('/glossary');
		const glossaries = page.getByTestId('glossaries');
		await expect(glossaries.getByRole('link', { name: /Work/ })).toContainText('2 terms · 1 to look up');
		await expect(glossaries.getByRole('link', { name: /Study/ })).toHaveCount(0);

		const unstarted = page.getByTestId('unstarted');
		await expect(unstarted).toContainText('Study');
		await unstarted.getByTestId('start-glossary').click();
		await expect(page).toHaveURL(/\/glossary\/study$/);
		expect(vaultFile('Study/Glossary.md')).toBe('# Glossary\n');
		// The rail picks the new glossary up at once.
		const rail = page.getByRole('navigation', { name: 'Modules' }).first();
		await expect(rail.getByTestId('sub-glossary').locator('a')).toHaveText(['Study', 'Work']);
	});

	test('filters by text and by chip', async ({ page }) => {
		await page.goto('/glossary/work');
		const count = page.getByTestId('glossary-count');
		const entries = page.getByTestId('glossary-entry');
		await expect(count).toHaveText('2 of 2 terms');
		await expect(entries.first()).toContainText('An open-source tool that versions datasets');
		await expect(entries.first()).toContainText('→ For Work, it makes training data traceable.');
		await expect(entries.first()).toContainText(`From ${PAST} Dev Weekly · definition drafted by Claude`);
		await expect(entries.first().locator('.badge')).toHaveCount(0);
		await expect(entries.first().locator('.category')).toHaveText('ML');

		await page.getByTestId('glossary-filter').fill('mlf');
		await expect(count).toHaveText('1 of 2 terms');
		await expect(entries).toHaveText([/MLflow/]);
		await page.getByTestId('glossary-filter').fill('');

		const tabs = page.getByTestId('glossary-tabs');
		await expect(tabs.getByRole('tab')).toHaveText(['All2', 'ML1', 'Tooling1', 'To look up1']);
		await expect(page.getByText('My guess')).toHaveCount(0);
		await tabs.getByRole('tab', { name: /To look up/ }).click();
		await expect(entries).toHaveText([/MLflow/]);
		await expect(entries.getByRole('button', { name: 'Look up with Claude' })).toBeVisible();
		await tabs.getByRole('tab', { name: /Tooling/ }).click();
		await expect(count).toHaveText('1 of 2 terms');
		await tabs.getByRole('tab', { name: /All/ }).click();
		await expect(count).toHaveText('2 of 2 terms');
		await expect(page.getByRole('button', { name: 'Look up all (1)' })).toBeVisible();
	});

	test('Add to glossary appends the captured term as a new entry', async ({ page }) => {
		const before = vaultFile('Work/Glossary.md');
		await page.goto('/glossary/work');
		const captured = page.getByTestId('captured-terms');
		// DVC was captured too, but the glossary already has it.
		await expect(captured.locator('b').first()).toHaveText('Cookie Cutter');
		await expect(captured).not.toContainText('DVC');
		await captured.getByTestId('add-term').click();
		await expect(page.getByTestId('captured-terms')).toHaveCount(0);
		expect(vaultFile('Work/Glossary.md')).toBe(
			`${before}\n## Cookie Cutter\n- status:: to-look-up\n- source:: [[${PAST} Dev Weekly]]\n`
		);
		await expect(page.getByTestId('glossary-count')).toHaveText('3 of 3 terms');
	});

	test('a term typed in is appended, to look up', async ({ page }) => {
		const before = vaultFile('Work/Glossary.md');
		await page.goto('/glossary/work');
		await page.getByTestId('new-term').fill('RPE');
		await page.getByTestId('new-category').fill('ML');
		await page.getByTestId('new-add').click();
		await expect(page.getByTestId('glossary-count')).toHaveText('3 of 3 terms');
		await expect(page.getByTestId('new-term')).toHaveValue('');
		expect(vaultFile('Work/Glossary.md')).toBe(`${before}\n## RPE\n- status:: to-look-up\n- category:: ML\n`);
		await expect(page.getByTestId('glossary-entry').filter({ hasText: 'RPE' }).locator('.badge')).toHaveText(['To look up']);

		// A term the glossary already has is refused, and the file is left alone.
		const after = vaultFile('Work/Glossary.md');
		await page.getByTestId('new-term').fill('dvc');
		await page.getByTestId('new-add').click();
		await expect(page.locator('.problem')).toHaveText('That term is already in the glossary.');
		expect(vaultFile('Work/Glossary.md')).toBe(after);
	});

	test('the notebook\'s old glossary address goes to the new one', async ({ page }) => {
		await page.goto('/meetings/work/glossary');
		await expect(page).toHaveURL(/\/glossary\/work$/);
		await expect(page.getByTestId('glossary-count')).toHaveText('2 of 2 terms');
	});

	test('a phone gets the glossary in one column', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		for (const path of ['/glossary', '/glossary/work']) {
			await page.goto(path);
			const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
			expect(overflow, path).toBeLessThanOrEqual(0);
		}
		// Not a bottom-bar tab: it is reached from More.
		await expect(page.getByTestId('tabbar').getByRole('link', { name: 'Glossary' })).toHaveCount(0);
	});
});
