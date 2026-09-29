import { test, expect } from '@playwright/test';
import { TODAY, vaultFile, waitForFile } from './helpers';

const MANG = 'Work/CRM/Mang Tomas Foods.md';

test.describe.serial('CRM', () => {
	test('the tab lists contacts by most recent interaction, filtered by kind and search', async ({ page }) => {
		await page.goto('/w/work');
		await page.getByTestId('tab').filter({ hasText: 'CRM' }).click();
		await expect(page).toHaveURL('/w/work/crm');

		const rows = page.getByTestId('crm-row');
		await expect(rows).toHaveCount(2);
		await expect(rows.first()).toContainText('Mang Tomas Foods');
		await expect(rows.first()).toContainText('2 entries');

		await page.getByTestId('crm-kind').filter({ hasText: 'lead' }).click();
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText('Print Co');

		await page.getByTestId('crm-kind').filter({ hasText: 'lead' }).click();
		await page.getByTestId('crm-search').fill('sales');
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText('Mang Tomas Foods');
	});

	test('New contact writes the note and opens it', async ({ page }) => {
		await page.goto('/w/work/crm');
		await page.getByTestId('crm-new').click();
		await page.getByTestId('crm-new-name').fill('Moorfields Eye Hospital');
		await page.getByTestId('crm-new-kind').selectOption('stakeholder');
		await page.getByTestId('crm-new-company').fill('NHS');
		await page.getByTestId('crm-new-submit').click();

		await expect(page).toHaveURL('/w/work/crm/Moorfields%20Eye%20Hospital');
		await expect(page.locator('h2')).toHaveText('Moorfields Eye Hospital');
		expect(vaultFile('Work/CRM/Moorfields Eye Hospital.md')).toBe(
			'---\nkind: stakeholder\ncompany: NHS\nrole:\nemail:\nphone:\nlinks:\n---\n\n## History\n'
		);
	});

	test('a name that clashes is refused in the form, and nothing is written', async ({ page }) => {
		const before = vaultFile(MANG);
		await page.goto('/w/work/crm');
		await page.getByTestId('crm-new').click();
		await page.getByTestId('crm-new-name').fill('mang tomas foods');
		await page.getByTestId('crm-new-submit').click();
		await expect(page.getByText('There is already a contact with that name.')).toBeVisible();
		expect(vaultFile(MANG)).toBe(before);
	});

	test('Add entry files a dated line under History, today by default', async ({ page }) => {
		const before = vaultFile(MANG);
		await page.goto('/w/work/crm/Mang%20Tomas%20Foods');
		await expect(page.getByTestId('crm-entry-day')).toHaveValue(TODAY);
		await page.getByTestId('crm-entry-text').fill('Placed the first order');
		await page.getByTestId('crm-entry-add').click();

		await expect(page.getByTestId('crm-history-entry').first()).toContainText('Placed the first order');
		expect(await waitForFile(MANG, (c) => c.includes('Placed the first order'))).toBe(true);
		const after = vaultFile(MANG);
		const added = `- ${TODAY} Placed the first order`;
		expect(after.split('\n').filter((l) => l !== added)).toEqual(before.split('\n'));
		expect(after.indexOf(added)).toBeGreaterThan(after.indexOf('## History'));
	});

	test('editing a field rewrites that line alone', async ({ page }) => {
		const before = vaultFile(MANG);
		await page.goto('/w/work/crm/Mang%20Tomas%20Foods');
		await page.getByTestId('crm-edit').click();
		await page.getByTestId('crm-field-role').fill('Head of sales');
		await page.getByTestId('crm-save').click();

		await expect(page.getByTestId('crm-details')).toContainText('Head of sales');
		expect(await waitForFile(MANG, (c) => c.includes('role: Head of sales'))).toBe(true);
		expect(vaultFile(MANG)).toBe(before.replace('role: Sales', 'role: Head of sales'));
	});

	test('works at phone size', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/w/work/crm');
		await expect(page.getByTestId('crm-row').first()).toBeVisible();
		await page.getByTestId('crm-new').click();
		await expect(page.getByTestId('crm-new-form')).toBeVisible();

		await page.goto('/w/work/crm/Mang%20Tomas%20Foods');
		await expect(page.getByTestId('crm-entry-text')).toBeVisible();
		await expect(page.getByTestId('crm-edit')).toBeVisible();
	});
});
