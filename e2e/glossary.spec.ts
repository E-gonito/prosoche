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
 * The one glossary is `Glossaries/Work.md`, from `fixtures/meetings.mjs`: DVC
 * looked up, MLflow waiting, and Cookie Cutter captured in a past Work
 * meeting but not yet added. The Work workspace names it with
 * `glossary: Work`; Study has meetings and names no glossary.
 */
test.describe('Glossary', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('lists each glossary with its size, and starts a new one by name', async ({ page }) => {
		await page.goto('/glossary');
		const glossaries = page.getByTestId('glossaries');
		await expect(glossaries.getByRole('link')).toHaveCount(1);
		await expect(glossaries.getByRole('link', { name: /Work/ })).toContainText('2 terms · 1 to look up · meetings of Work');

		// A name another glossary has, ignoring case, is refused.
		await page.getByTestId('new-glossary-name').fill('work');
		await page.getByTestId('new-glossary-create').click();
		await expect(page.locator('.problem')).toHaveText('There is already a glossary with that name.');

		await page.getByTestId('new-glossary-name').fill('Computer Science');
		await page.getByTestId('new-glossary-create').click();
		await expect(page).toHaveURL(/\/glossary\/computer-science$/);
		expect(vaultFile('Glossaries/Computer Science.md')).toBe('# Glossary\n');
		// No workspace points at it, so there is no meeting to start from here.
		await expect(page.getByTestId('start-a-meeting')).toHaveCount(0);
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
		// Still fed by Work's meetings.
		await expect(page.getByTestId('captured-terms')).toContainText('Cookie Cutter');
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

	test('offers no Start a meeting, only a link to the notebook of the workspace pointing here', async ({ page }) => {
		await page.goto('/glossary/work');
		await expect(page.getByTestId('start-a-meeting')).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Work meetings' })).toHaveAttribute('href', '/meetings/work');
	});

	test('a glossary asks for a folder before it scans, and remembers the folders in its frontmatter', async ({ page }) => {
		const before = vaultFile('Glossaries/Work.md');
		await page.goto('/glossary/work');
		const scan = page.getByTestId('glossary-scan');
		await expect(scan.getByTestId('scan-needs-folder')).toBeVisible();
		await expect(scan.getByTestId('scan-run')).toHaveCount(0);
		await expect(page.locator('#scan-folders option[value="Study"]')).toHaveCount(1);
		await expect(page.locator('#scan-folders option[value="Glossaries"]')).toHaveCount(0);

		await scan.getByTestId('scan-folder').fill('Study');
		await scan.getByTestId('scan-folder-add').click();
		await expect(scan.getByTestId('scan-sources')).toContainText('Study/');
		// Nothing is read until pressed: the button only counts the notes.
		await expect(scan.getByTestId('scan-run')).toHaveText(/^Scan all \d+ notes?$/);
		expect(vaultFile('Glossaries/Work.md')).toBe(`---\nsources:\n  - Study\n---\n\n${before}`);

		await scan.getByRole('button', { name: 'Stop scanning Study' }).click();
		await expect(scan.getByTestId('scan-needs-folder')).toBeVisible();
		expect(vaultFile('Glossaries/Work.md')).toBe(`---\nsources:\n---\n\n${before}`);
	});

	test('terms kept from a scan are checked again, appended, and mark the glossary scanned', async ({ page, request }) => {
		await request.post('/api/glossary', { data: { action: 'set-sources', glossary: 'work', sources: ['Study'] } });
		const sourced = vaultFile('Glossaries/Work.md');
		const term = { term: 'Binary search', category: 'Algorithms', definition: 'Halves the range at each step.', relevance: 'Chapter 3 leans on it.', source: 'Study/Algorithms.md' };

		// A term the glossary has, or a note outside its folders, refuses the lot.
		for (const bad of [{ ...term, term: 'dvc' }, { ...term, source: 'Work/Handbook.md' }]) {
			const refused = await request.post('/api/glossary', { data: { action: 'add-scanned', glossary: 'work', entries: [term, bad], complete: true } });
			expect(refused.status()).toBe(400);
			expect(vaultFile('Glossaries/Work.md')).toBe(sourced);
		}

		const added = await request.post('/api/glossary', { data: { action: 'add-scanned', glossary: 'work', entries: [term], complete: true } });
		expect(await added.json()).toMatchObject({ ok: true, added: 1 });
		const content = vaultFile('Glossaries/Work.md');
		expect(content).toMatch(/^---\nsources:\n {2}- Study\nscanned: "\d{4}-\d{2}-\d{2}"\n---\n/);
		expect(content.endsWith(
			'\n## Binary search\n- status:: looked-up\n- category:: Algorithms\n- source:: [[Algorithms]]\n- drafted:: Claude\n\nHalves the range at each step.\n\n→ Chapter 3 leans on it.\n'
		)).toBe(true);

		await page.goto('/glossary/work');
		await expect(page.getByTestId('glossary-entry').filter({ hasText: 'Binary search' })).toContainText('definition drafted by Claude');
		await expect(page.getByTestId('scan-run')).toHaveText(/^(Scan \d+ notes? changed|No notes changed) since \d{1,2} [A-Z][a-z]{2}$/);
		await expect(page.getByTestId('scan-all')).toHaveText(/^Scan all \d+ notes? instead$/);
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

	test('Add to glossary appends the captured term as a new entry', async ({ page }) => {
		const before = vaultFile('Glossaries/Work.md');
		await page.goto('/glossary/work');
		const captured = page.getByTestId('captured-terms');
		// DVC was captured too, but the glossary already has it.
		await expect(captured.locator('b').first()).toHaveText('Cookie Cutter');
		await expect(captured).not.toContainText('DVC');
		await captured.getByTestId('add-term').click();
		await expect(page.getByTestId('captured-terms')).toHaveCount(0);
		expect(vaultFile('Glossaries/Work.md')).toBe(
			`${before}\n## Cookie Cutter\n- status:: to-look-up\n- source:: [[${PAST} Dev Weekly]]\n`
		);
		await expect(page.getByTestId('glossary-count')).toHaveText('3 of 3 terms');
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

	test('a term is deleted after a confirm, and nothing else changes', async ({ page }) => {
		const before = vaultFile('Glossaries/Work.md');
		await page.goto('/glossary/work');
		page.once('dialog', (dialog) => dialog.accept());
		await page.getByTestId('glossary-entry').filter({ hasText: 'MLflow' }).getByTestId('delete-term').click();
		await expect(page.getByTestId('glossary-count')).toHaveText('1 of 1 terms');
		expect(vaultFile('Glossaries/Work.md')).toBe(before.replace(/\n## MLflow\n[\s\S]*$/, ''));
	});

	test('the notebook\'s old glossary address goes to the glossary the workspace names, or the list', async ({ page }) => {
		await page.goto('/meetings/work/glossary');
		await expect(page).toHaveURL(/\/glossary\/work$/);
		await expect(page.getByTestId('glossary-count')).toHaveText('2 of 2 terms');
		await page.goto('/meetings/study/glossary');
		await expect(page).toHaveURL(/\/glossary$/);
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
