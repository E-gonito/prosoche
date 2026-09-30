import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetVault, VAULT, vaultFile } from './helpers';

/** The day before today, as the glossary fixture computes it. */
const PAST = (() => {
	const now = new Date();
	const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
})();

/*
 * The one glossary is `Glossaries/Work.md`, from `fixtures/glossary.mjs`: DVC
 * looked up, MLflow waiting. The Work workspace names it with
 * `glossary: Work`; Study names no glossary.
 */
test.describe('Glossary', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('lists each glossary with its size, and starts a new one by name', async ({ page }) => {
		await page.goto('/glossary');
		const glossaries = page.getByTestId('glossaries');
		await expect(glossaries.getByRole('link')).toHaveCount(1);
		await expect(glossaries.getByRole('link', { name: /Work/ })).toContainText('2 terms · 1 to look up');

		// A name another glossary has, ignoring case, is refused.
		await page.getByTestId('new-glossary-name').fill('work');
		await page.getByTestId('new-glossary-create').click();
		await expect(page.locator('.problem')).toHaveText('There is already a glossary with that name.');

		await page.getByTestId('new-glossary-name').fill('Computer Science');
		await page.getByTestId('new-glossary-create').click();
		await expect(page).toHaveURL(/\/glossary\/computer-science$/);
		expect(vaultFile('Glossaries/Computer Science.md')).toBe('# Glossary\n');
		// The rail picks the new glossary up at once.
		const rail = page.getByRole('navigation', { name: 'Modules' }).first();
		await expect(rail.getByTestId('sub-glossary').locator('a')).toHaveText(['Computer Science', 'Work']);
	});

	test('a glossary is renamed in place, and the workspace pointing at it follows', async ({ page }) => {
		const content = vaultFile('Glossaries/Work.md');
		const definition = vaultFile('_hub/workspaces/work.md');
		await page.goto('/glossary/work');
		await page.getByTestId('rename-glossary').click();
		await page.getByTestId('rename-name').fill('Eye2Gene');
		await page.getByTestId('rename-save').click();
		await expect(page).toHaveURL(/\/glossary\/eye2gene$/);
		await expect(page.locator('h1')).toHaveText('Eye2Gene');
		expect(vaultFile('Glossaries/Eye2Gene.md')).toBe(content);
		expect(vaultFile('Glossaries/Work.md')).toBe('');
		expect(vaultFile('_hub/workspaces/work.md')).toBe(definition.replace('glossary: Work', 'glossary: Eye2Gene'));
	});

	test('a glossary is deleted after asking in place', async ({ page }) => {
		await page.goto('/glossary/work');
		await page.getByTestId('delete-glossary').click();
		await expect(page.getByTestId('delete-glossary-ask')).toContainText('Delete this glossary and its 2 terms?');
		await page.getByTestId('delete-glossary-confirm').click();
		await expect(page).toHaveURL(/\/glossary$/);
		expect(vaultFile('Glossaries/Work.md')).toBe('');
		await expect(page.getByTestId('glossaries')).toContainText('No glossary yet.');
	});

	test('filters by text and by category tab', async ({ page }) => {
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

	test('a term typed in is appended, to look up', async ({ page }) => {
		const before = vaultFile('Glossaries/Work.md');
		await page.goto('/glossary/work');
		await page.getByTestId('new-term').fill('RPE');
		await page.getByTestId('new-category').fill('ML');
		await page.getByTestId('new-add').click();
		await expect(page.getByTestId('glossary-count')).toHaveText('3 of 3 terms');
		await expect(page.getByTestId('new-term')).toHaveValue('');
		expect(vaultFile('Glossaries/Work.md')).toBe(`${before}\n## RPE\n- status:: to-look-up\n- category:: ML\n`);
		await expect(page.getByTestId('glossary-entry').filter({ hasText: 'RPE' }).locator('.badge')).toHaveText(['To look up']);

		// A term the glossary already has is refused, and the file is left alone.
		const after = vaultFile('Glossaries/Work.md');
		await page.getByTestId('new-term').fill('dvc');
		await page.getByTestId('new-add').click();
		await expect(page.locator('.problem')).toHaveText('That term is already in the glossary.');
		expect(vaultFile('Glossaries/Work.md')).toBe(after);
	});

	test('a term is edited in place, and a pending one becomes looked up', async ({ page }) => {
		const before = vaultFile('Glossaries/Work.md');
		await page.goto('/glossary/work');
		const mlflow = page.getByTestId('glossary-entry').filter({ hasText: 'MLflow' });
		await mlflow.getByTestId('edit-term-open').click();
		await expect(page.getByTestId('edit-term')).toHaveValue('MLflow');
		await expect(page.getByTestId('edit-category')).toHaveValue('Tooling');
		await page.getByTestId('edit-term').fill('MLflow Tracking');
		await page.getByTestId('edit-definition').fill('Records runs, parameters and metrics.');
		await page.getByTestId('edit-relevance').fill('How we compare model versions.');
		await page.getByTestId('edit-save').click();

		const edited = page.getByTestId('glossary-entry').filter({ hasText: 'MLflow Tracking' });
		await expect(edited).toContainText('Records runs, parameters and metrics.');
		await expect(edited).toContainText('→ How we compare model versions.');
		await expect(edited.locator('.badge')).toHaveCount(0);
		expect(vaultFile('Glossaries/Work.md')).toBe(
			before.replace(
				'## MLflow\n- status:: to-look-up\n- category:: Tooling\n',
				'## MLflow Tracking\n- status:: looked-up\n- category:: Tooling\n\nRecords runs, parameters and metrics.\n\n→ How we compare model versions.\n'
			)
		);

		// Renaming onto another term is refused, and the file is left alone.
		const after = vaultFile('Glossaries/Work.md');
		await edited.getByTestId('edit-term-open').click();
		await page.getByTestId('edit-term').fill('dvc');
		await page.getByTestId('edit-save').click();
		await expect(page.locator('.problem')).toHaveText('Another term already has that name.');
		expect(vaultFile('Glossaries/Work.md')).toBe(after);
	});

	test('linked to a study subject, every defined term is a card there, kept in step with the glossary', async ({ page }) => {
		const CARDS = 'Study/Flashcards/Glossary/Work/ML.md';
		const header =
			'---\ngoal:\nglossary: Work\ncategory: ML\n---\n\n#flashcards\n\nMade from [[Work]] (ML). Edit the terms there; this file is\nkept in step with the glossary.\n';
		const dvcCard = (definition: string) => `DVC\n??\n${definition}\n→ For Work, it makes training data traceable.\n`;
		const before = vaultFile('Glossaries/Work.md');
		await page.goto('/glossary/work');
		await expect(page.getByTestId('glossary-cards-state')).toContainText('Not linked');

		await page.getByTestId('glossary-study').selectOption('study');
		const state = page.getByTestId('glossary-cards-state');
		await expect(state).toContainText('1 card in Study · up to date');
		await expect(state.getByRole('link')).toHaveAttribute('href', '/study/study/flashcards');
		expect(vaultFile('Glossaries/Work.md')).toBe(`---\nstudy: study\n---\n\n${before}`);
		// DVC has a definition; MLflow, still to look up, has no card yet.
		expect(vaultFile(CARDS)).toBe(`${header}\n${dvcCard('An open-source tool that versions datasets and models alongside git.')}`);

		// A card's review comment stays when the definition changes.
		const comment = '<!--fsrs:2030-01-01,3.21,5.8,4,0,review,2029-12-29!new-->';
		writeFileSync(join(VAULT, CARDS), `${vaultFile(CARDS)}${comment}\n`);
		const dvc = page.getByTestId('glossary-entry').filter({ hasText: 'DVC' });
		await dvc.getByTestId('edit-term-open').click();
		await page.getByTestId('edit-definition').fill('Version control for data and models.');
		await page.getByTestId('edit-save').click();
		await expect(dvc).toContainText('Version control for data and models.');
		expect(vaultFile(CARDS)).toBe(`${header}\n${dvcCard('Version control for data and models.')}${comment}\n`);

		// Unlinking stops the syncing and leaves the cards.
		await page.getByTestId('glossary-study').selectOption('');
		await expect(page.getByTestId('glossary-cards-state')).toContainText('Not linked');
		expect(vaultFile('Glossaries/Work.md').startsWith('---\nstudy:\n---\n')).toBe(true);
		expect(vaultFile(CARDS)).toContain('Version control for data and models.');
	});

	test('a term is deleted after a confirm, and nothing else changes', async ({ page }) => {
		const before = vaultFile('Glossaries/Work.md');
		await page.goto('/glossary/work');
		page.once('dialog', (dialog) => dialog.accept());
		await page.getByTestId('glossary-entry').filter({ hasText: 'MLflow' }).getByTestId('delete-term').click();
		await expect(page.getByTestId('glossary-count')).toHaveText('1 of 1 terms');
		expect(vaultFile('Glossaries/Work.md')).toBe(before.replace(/\n## MLflow\n[\s\S]*$/, ''));
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
