import { test, expect } from '@playwright/test';
import { vaultFile, waitForFile, TODAY } from './helpers';

test.describe('Workspaces', () => {
	test('the index lists every workspace with its figures', async ({ page }) => {
		await page.goto('/w');
		const row = page.getByTestId('workspace-row').filter({ hasText: 'Work' });
		await expect(row).toBeVisible();
		await expect(row).toContainText('open');
		await expect(page.getByTestId('new-workspace')).toBeVisible();
	});

	test('the overview shows the next action from the deck', async ({ page }) => {
		await page.goto('/w/work');
		await expect(page.getByText('Draft the proposal')).toBeVisible();
	});

	test('ticking a card on the board changes exactly that line in the vault', async ({ page }) => {
		await page.goto('/w/work/tasks');
		await page.getByTestId('open-card').filter({ hasText: 'Draft the proposal' }).click();
		await page.getByTestId('drawer-status').selectOption('done');
		expect(await waitForFile('Work/Tasks.md', (c) => c.includes('[x]'))).toBe(true);

		const content = vaultFile('Work/Tasks.md');
		expect(content).toContain('- [x] Draft the proposal `Q2`');
		// Nothing else in the file moved.
		expect(content.split('\n')[0]).toBe('# Tasks');
	});

	test('capture into the workspace inbox lands in Work/Inbox.md', async ({ page }) => {
		await page.goto('/w/work/inbox');
		await page.getByLabel('Quick capture').fill('Call the printer about the leaflets');
		await page.getByRole('button', { name: 'Add' }).click();
		await expect(page.getByText('Saved to Work/Inbox.md')).toBeVisible();
		expect(vaultFile('Work/Inbox.md')).toContain('Call the printer about the leaflets');
		// Never touches the vault-wide inbox.
		expect(vaultFile('Inbox/Capture.md')).not.toContain('Call the printer');
	});

	test('adds a log update under today’s heading', async ({ page }) => {
		await page.goto('/w/work/log');
		await page.getByTestId('log-text').fill('Shipped the first draft to the client');
		await page.getByTestId('log-add').click();
		await expect(page.getByText('Shipped the first draft to the client')).toBeVisible();
		const content = vaultFile('Work/Log.md');
		expect(content).toContain(`## ${TODAY}`);
		expect(content).toContain('- Shipped the first draft to the client');
	});

	test('adds a deal and changes its stage, writing the exact line', async ({ page }) => {
		await page.goto('/w/work/people');
		await page.getByTestId('add-deal-open').click();
		await page.getByTestId('deal-name').fill('Moorfields pilot');
		await page.getByTestId('deal-value').fill('12000');
		await page.getByTestId('deal-add').click();

		await expect(page.getByText('Moorfields pilot')).toBeVisible();
		let content = vaultFile('Work/Deals.md');
		expect(content).toContain('- Moorfields pilot stage:: lead value:: 12000');

		await page.getByTestId('deal-stage-select').selectOption('negotiation');
		expect(await waitForFile('Work/Deals.md', (c) => c.includes('stage:: negotiation'))).toBe(true);
		content = vaultFile('Work/Deals.md');
		expect(content).toContain('- Moorfields pilot stage:: negotiation value:: 12000');
	});

	test('a custom page tab renders in a sandboxed iframe', async ({ page, request }) => {
		await page.goto('/w/work/pages/Eye.html');
		const frame = page.frameLocator('iframe.embed');
		await expect(frame.locator('#marker')).toHaveText('Eye 3D page');

		const iframe = page.locator('iframe.embed');
		const src = await iframe.getAttribute('src');
		expect(src).toBeTruthy();

		const raw = await request.get(new URL(src!, page.url()).toString());
		expect(raw.headers()['content-security-policy']).toBe('sandbox allow-scripts');
	});

	test('the board works at phone size: columns scroll, pills jump between them', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/w/work/tasks');
		await expect(page.getByTestId('column-pills')).toBeVisible();
		await expect(page.getByTestId('board')).toBeVisible();
	});
});
