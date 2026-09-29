import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TODAY, VAULT, resetVault, vaultFile, waitForFile } from './helpers';

/** The day before today, as the fixture computes it. */
const PAST = (() => {
	const [y, m, d] = TODAY.split('-').map(Number);
	const date = new Date(y, m - 1, d - 1);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
})();
const PAST_NOTE = `Work/Meetings/${PAST} Dev Weekly.md`;

test.describe('Meetings', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('the page works without a calendar and lists the notebooks', async ({ page }) => {
		await page.goto('/meetings');
		// No calendar connected is the normal case, and the page is quiet about it.
		await expect(page.getByTestId('no-calendar')).toHaveCount(0);
		const notebooks = page.getByTestId('notebooks');
		await expect(notebooks.getByRole('link', { name: /Work/ })).toContainText('1 meeting');
		await expect(notebooks.getByRole('link', { name: /Study/ })).toContainText('no primer');
		await notebooks.getByRole('link', { name: /Work/ }).click();
		await expect(page).toHaveURL(/\/meetings\/work$/);
	});

	test('a workspace without meetings: true has no notebook', async ({ page }) => {
		// Written by the test rather than the fixture, so no other suite sees a
		// third workspace; the next reset cleans it away.
		mkdirSync(join(VAULT, 'Garden'), { recursive: true });
		writeFileSync(join(VAULT, 'Garden/Plan.md'), '# Plan\n');
		writeFileSync(join(VAULT, '_hub/workspaces/garden.md'), '---\nname: Garden\ncolor: "#16a34a"\nfolders:\n  - "Garden"\n---\n');

		await page.goto('/meetings');
		const notebooks = page.getByTestId('notebooks');
		await expect(notebooks.getByRole('link', { name: /Work/ })).toBeVisible();
		await expect(notebooks.getByRole('link', { name: /Garden/ })).toHaveCount(0);

		const response = await page.goto('/meetings/garden');
		expect(response?.status()).toBe(404);
		await expect(page.locator('body')).toContainText('Add "meetings: true" to _hub/workspaces/garden.md');

		await page.goto('/w/garden');
		await expect(page.locator('.label', { hasText: 'Meetings' })).toHaveCount(0);
		await page.goto('/w/work');
		await expect(page.getByRole('link', { name: /meeting notebook/ })).toHaveAttribute('href', '/meetings/work');
	});

	test('the card renders the primer in the artifact\'s shape', async ({ page }) => {
		await page.goto('/meetings/work');
		// Eye is Work/Pages/eye.html from the Workspaces fixture, served by that module.
		await expect(page.locator('.tabs a')).toHaveText(['Meeting card', 'Notes', 'Glossary', 'Eye']);
		await expect(page.locator('.tabs a', { hasText: 'Eye' })).toHaveAttribute('href', '/w/work/pages/Eye.html');
		const primer = page.getByTestId('primer');
		await expect(primer.locator('.lead')).toContainText('Your job in the room is to turn talk into constraints.');
		await expect(primer.locator('.lead')).not.toContainText('Work primer');
		await expect(primer.locator('.callout')).toContainText('Rate limit:');
		await expect(primer.locator('.label')).toHaveText(['Your product, in numbers', 'Four frames']);
		await expect(primer.locator('li', { hasText: 'Ensemble of 15 CNNs.' })).toBeVisible();
		await expect(page.getByTestId('draft-run')).toHaveText('Suggest updates');
	});

	test('a workspace with no primer offers a draft', async ({ page }) => {
		await page.goto('/meetings/study');
		await expect(page.getByTestId('primer-empty')).toBeVisible();
		await expect(page.getByTestId('draft-run')).toHaveText('Draft a primer with Claude');
	});

	test('ticking an open action rewrites exactly that line', async ({ page }) => {
		const before = vaultFile(PAST_NOTE);
		await page.goto('/meetings/work/notes');
		const actions = page.getByTestId('open-action');
		await expect(actions).toHaveCount(1);
		await expect(actions).toContainText('Clarify scope with the manager');
		await expect(actions).toContainText(`from Dev Weekly ${PAST}`);
		await actions.getByRole('checkbox').check();
		expect(await waitForFile(PAST_NOTE, (c) => c.includes('- [x] action:: Clarify scope with the manager'))).toBe(true);
		expect(vaultFile(PAST_NOTE)).toBe(before.replace('- [ ] action:: Clarify scope', '- [x] action:: Clarify scope'));
		await expect(page.getByTestId('open-action')).toHaveCount(0);
	});

	test('start a meeting, capture into it and end it', async ({ page }) => {
		const path = `Work/Meetings/${TODAY} Design review.md`;
		await page.goto('/meetings/work/notes');
		await expect(page.getByRole('button', { name: 'Prep with Claude' })).toBeVisible();
		await page.getByTestId('meeting-title').fill('Design review');
		await page.getByTestId('start-meeting').click();
		await expect(page.getByTestId('end-meeting')).toBeVisible();
		const header = `---\ntype: meeting\ndate: ${TODAY}\n---\n# Design review\n\n## Captured\n`;
		expect(vaultFile(path)).toBe(header);

		await page.getByTestId('capture-kind-term').click();
		await page.getByTestId('capture-text').fill('Cookie Cutter');
		await page.getByTestId('capture-guess').fill('something for AI models');
		await page.getByTestId('capture-add').click();
		await expect(page.getByTestId('current-meeting')).toContainText('my guess: something for AI models');

		await page.getByTestId('capture-kind-decision').click();
		await page.getByTestId('capture-text').fill('Deploy to ECS, not Beanstalk');
		await page.getByTestId('capture-text').press('Enter');
		await expect(page.getByTestId('current-meeting')).toContainText('Deploy to ECS');

		await page.getByTestId('capture-kind-action').click();
		await page.getByTestId('capture-text').fill('Write up the decision');
		await page.getByTestId('capture-add').click();
		await expect(page.getByTestId('current-meeting')).toContainText('Write up the decision');

		const captured =
			header +
			'- term:: Cookie Cutter guess:: something for AI models\n' +
			'- decision:: Deploy to ECS, not Beanstalk\n' +
			'- [ ] action:: Write up the decision\n';
		expect(vaultFile(path)).toBe(captured);
		// The new action is open, so it is waiting under Before you go in too.
		await expect(page.getByTestId('open-action')).toHaveCount(2);

		await page.getByTestId('end-meeting').click();
		await expect(page.getByTestId('start-meeting')).toBeVisible();
		const ended = vaultFile(path);
		const line = /^ended: (\d{2}:\d{2})$/m.exec(ended);
		expect(line).not.toBeNull();
		expect(ended).toBe(captured.replace(`date: ${TODAY}\n---`, `date: ${TODAY}\nended: ${line![1]}\n---`));
		await expect(page.getByTestId('past-meeting').first()).toContainText('Design review');
	});

	test('past meetings expand to their captured items', async ({ page }) => {
		await page.goto('/meetings/work/notes');
		const past = page.getByTestId('past-meeting').filter({ hasText: 'Dev Weekly' });
		await expect(past).toContainText('6 items');
		await past.locator('summary').click();
		await expect(past.locator('.label')).toHaveText(['Terms', 'Questions', 'Decisions', 'Actions']);
		await expect(past).toContainText('Cookie Cutter · my guess: something for AI models');
		await expect(past.getByRole('link', { name: 'Open the note' })).toHaveAttribute('href', /\/notes\/Work\/Meetings\//);
	});

	test('the glossary filters by text and by chip', async ({ page }) => {
		await page.goto('/meetings/work/glossary');
		const count = page.getByTestId('glossary-count');
		const entries = page.getByTestId('glossary-entry');
		await expect(count).toHaveText('2 of 2 terms');
		await expect(entries.first()).toContainText('An open-source tool that versions datasets');
		await expect(entries.first()).toContainText('→ For Work, it makes training data traceable.');
		await expect(entries.first()).toContainText(`From ${PAST} Dev Weekly · definition drafted by Claude`);
		await expect(entries.first().locator('.badge')).toHaveText(['Mine', 'Looked up']);

		await page.getByTestId('glossary-filter').fill('mlf');
		await expect(count).toHaveText('1 of 2 terms');
		await expect(entries).toHaveText([/MLflow/]);
		await page.getByTestId('glossary-filter').fill('');

		const chips = page.getByTestId('glossary-chips');
		await expect(chips.getByRole('button')).toHaveText(['All', 'Mine (1)', 'To look up', 'ML', 'Tooling']);
		await chips.getByRole('button', { name: 'Mine (1)' }).click();
		await expect(entries).toHaveText([/DVC/]);
		await chips.getByRole('button', { name: 'To look up' }).click();
		await expect(entries).toHaveText([/MLflow/]);
		await expect(entries.getByRole('button', { name: 'Look up with Claude' })).toBeVisible();
		await chips.getByRole('button', { name: 'Tooling' }).click();
		await expect(count).toHaveText('1 of 2 terms');
		await chips.getByRole('button', { name: 'All' }).click();
		await expect(count).toHaveText('2 of 2 terms');
		await expect(page.getByRole('button', { name: 'Look up all (1)' })).toBeVisible();
	});

	test('Add to glossary appends the captured term as a new entry', async ({ page }) => {
		const before = vaultFile('Work/Glossary.md');
		await page.goto('/meetings/work/glossary');
		const captured = page.getByTestId('captured-terms');
		// DVC was captured too, but the glossary already has it.
		await expect(captured.locator('b:not(.guess b)').first()).toHaveText('Cookie Cutter');
		await expect(captured).not.toContainText('DVC');
		await captured.getByTestId('add-term').click();
		await expect(page.getByTestId('captured-terms')).toHaveCount(0);
		expect(vaultFile('Work/Glossary.md')).toBe(
			`${before}\n## Cookie Cutter\n- guess:: something for AI models\n- status:: to-look-up\n- source:: [[${PAST} Dev Weekly]]\n`
		);
		await expect(page.getByTestId('glossary-count')).toHaveText('3 of 3 terms');
	});

	test('a phone gets the notebook in one column', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		for (const path of ['/meetings', '/meetings/work', '/meetings/work/notes', '/meetings/work/glossary']) {
			await page.goto(path);
			const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
			expect(overflow, path).toBeLessThanOrEqual(0);
		}
		await page.goto('/meetings/work/notes');
		await expect(page.getByTestId('tabbar').getByRole('link', { name: 'Meetings' })).toHaveAttribute('aria-current', 'page');
		await page.getByTestId('meeting-title').fill('Standup');
		await page.getByTestId('start-standup').click();
		const text = page.getByTestId('capture-text');
		const add = page.getByTestId('capture-add');
		await expect(text).toBeVisible();
		const [a, b] = [await text.boundingBox(), await add.boundingBox()];
		// The Add button sits under the text box rather than squeezed beside it.
		expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
		expect(vaultFile(`Work/Meetings/${TODAY} Standup.md`)).toContain('type: standup');
	});
});
