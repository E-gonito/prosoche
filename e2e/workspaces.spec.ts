import { test, expect } from '@playwright/test';
import { vaultFile, TODAY } from './helpers';

test.describe('Workspaces', () => {
	test('the index lists every workspace with its figures', async ({ page }) => {
		await page.goto('/w');
		const row = page.getByTestId('workspace-row').filter({ hasText: 'Work' });
		await expect(row).toBeVisible();
		await expect(row).toContainText('open');
		await expect(page.getByTestId('new-workspace')).toBeVisible();
	});

	test('Overview points the workspace at another folder, and stops again', async ({ page }) => {
		await page.goto('/w/work');
		const folders = page.getByTestId('folders');
		await folders.getByTestId('folder-input').fill('Clients/Acme/');
		await folders.getByRole('button', { name: 'Add' }).click();
		await expect(folders.getByText('Clients/Acme/')).toBeVisible();
		let content = vaultFile('_hub/workspaces/work.md');
		expect(content).toMatch(/\nfolders:\n  - Work\n  - Clients\/Acme\ntabs:\n/);
		expect(content).toContain('glossary: Work\n');

		await folders.getByRole('button', { name: 'Stop reading Clients/Acme' }).click();
		await expect(folders.getByText('Clients/Acme/')).toHaveCount(0);
		content = vaultFile('_hub/workspaces/work.md');
		expect(content).toMatch(/\nfolders:\n  - Work\ntabs:\n/);
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
