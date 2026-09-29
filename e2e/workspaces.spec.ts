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
});
