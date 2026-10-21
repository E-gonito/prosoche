import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resetVault, VAULT, vaultFile, waitForFile } from './helpers';

/**
 * Tactics, from an empty `Tactics/`: the starter scenarios played as they
 * are, on the keyboard, and logged; an ROE violation capping the grade; and
 * retiring one out of every mission.
 */

const now = new Date();
const MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const LOG = `Tactics/Attempts/${MONTH}.md`;

function write(path: string, content: string) {
	mkdirSync(dirname(join(VAULT, path)), { recursive: true });
	writeFileSync(join(VAULT, path), content);
}

test.describe('Tactics', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('adds the starter scenarios, and plays a mission of them on the keyboard with nothing to approve', async ({ page }) => {
		await page.goto('/tactics');
		await page.getByTestId('add-starters').click();
		await expect(page.getByTestId('scenario-list').locator('li')).toHaveCount(8);
		expect(vaultFile('Tactics/To verify in game.md')).toContain('# To verify in game');

		// Drafts play as they are: there is no approving step and no switch for it.
		await page.getByTestId('mode-bodycam').click();
		await expect(page.getByTestId('include-drafts')).toHaveCount(0);
		await expect(page.getByTestId('mode-bodycam')).toContainText('8');
		await page.getByTestId('start-mission').click();
		await page.getByTestId('mission-begin').click();

		for (let i = 0; i < 8; i++) {
			const drill = page.getByTestId('drill');
			await expect(drill).toBeVisible();
			await expect(page.getByTestId('why')).toHaveCount(0);
			// Read first, untimed: no options until Space starts the clock.
			await expect(drill).toHaveAttribute('data-phase', 'brief');
			await expect(page.getByTestId('drill-options')).toHaveCount(0);
			await page.keyboard.press(' ');
			await expect(drill).toHaveAttribute('data-phase', 'drill');
			if ((await drill.getAttribute('data-drill')) === 'clear-order') {
				const angles = await page.locator('[data-testid^="angle-"]').count();
				for (let n = 1; n <= angles; n++) await page.keyboard.press(String(n));
			} else {
				// C answers option C; it must not open quick capture.
				await page.keyboard.press('c');
			}
			await expect(page.getByTestId('verdict')).toBeVisible();
			await page.keyboard.press(' ');
		}

		await expect(page.getByTestId('debrief')).toBeVisible();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.getByTestId('save-state')).toHaveText('Saved to the attempt log.');
		await expect(page.getByTestId('mission-grade')).toHaveText(/^[SABCD]$/);
		await expect(page.getByTestId('time-distribution').locator('li')).toHaveCount(8);

		const lines = vaultFile(LOG).split('\n').filter((l) => l.startsWith('- '));
		expect(lines).toHaveLength(8);
		expect(lines[0]).toMatch(/^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2} cqb-\d{4} answer:: \S+ result:: (in-time|late|wrong|timeout) /);

		// A miss asks first, then shows the Why with its provenance.
		const miss = page.getByTestId('miss').first();
		if (await miss.count()) {
			await miss.getByTestId('reveal-why').click();
			await expect(miss.getByTestId('why')).toContainText('Provenance: inferred');
		}
	});

	test('an ROE violation caps the mission at D', async ({ page }) => {
		write(
			'Tactics/Scenarios/ron-0001.md',
			`---
type: tactic-scenario
id: ron-0001
game: ron
drill: threat-call
tags: [roe.compliance]
difficulty: 1
time_limit_s: 10
provenance: own-aar
status: approved
roe_violation: [A]
---

## Situation
Suspect in the hallway, pistol held low, not aimed.

## Options
- A: Lethal force
- B: Shout a compliance command

## Answer
B

## Why
Not aimed at anyone, and no command given yet.
`
		);
		await expect(async () => {
			await page.goto('/tactics/mission?mode=aar-review&n=8');
			await expect(page.getByTestId('mission-begin')).toBeVisible({ timeout: 1000 });
		}).toPass();
		await page.keyboard.press(' ');
		await page.keyboard.press(' ');
		await page.keyboard.press('a');
		await expect(page.getByTestId('roe-violation')).toBeVisible();
		await page.keyboard.press(' ');
		await expect(page.getByTestId('mission-grade')).toHaveText('D');
		await expect(page.getByTestId('debrief-roe')).toContainText('1 ROE violation');
		expect(await waitForFile(LOG, (c) => c.includes('ron-0001 answer:: A result:: wrong correct:: false') && c.includes('roe:: true'))).toBe(true);
	});

	test('retiring a scenario takes it out of missions, changing only its status, and Bring back undoes it', async ({ page, request }) => {
		await request.post('/api/tactics/starters', { data: {} });
		const path = 'Tactics/Scenarios/cqb-0002.md';
		const before = vaultFile(path);
		await expect(async () => {
			await page.goto('/tactics/scenario/cqb-0002');
			await expect(page.getByTestId('retire')).toBeVisible({ timeout: 1000 });
		}).toPass();
		await expect(page.getByTestId('approve')).toHaveCount(0);

		await page.getByTestId('retire').click();
		await expect(page.getByTestId('scenario-status')).toContainText('retired');
		expect(vaultFile(path)).toBe(before.replace('status: draft', 'status: retired'));
		await page.goto('/tactics');
		await expect(page.getByTestId('mode-bodycam')).toContainText('7');

		await page.goto('/tactics/scenario/cqb-0002');
		await page.getByTestId('unretire').click();
		await expect(page.getByTestId('retire')).toBeVisible();
		expect(vaultFile(path)).toBe(before);
	});

	test('an after-action review becomes a draft scenario in your words', async ({ page }) => {
		await page.goto('/tactics/aar');
		await page.getByTestId('aar-map').fill('Warehouse');
		await page.getByTestId('aar-happened').fill('Peeked the same angle twice and got shot.');
		await page.getByTestId('aar-did').fill('Peeked again');
		await page.getByTestId('aar-should').fill('Swung wide from the other side');
		await page.getByTestId('aar-tags').fill('bodycam.peek');
		await page.getByTestId('aar-save').click();

		await expect(page).toHaveURL(/\/tactics\/scenario\/bc-0001$/);
		await expect(page.getByTestId('retire')).toBeVisible();
		expect(vaultFile('Tactics/Scenarios/bc-0001.md')).toContain('Swung wide from the other side');
		expect(vaultFile('Tactics/Scenarios/bc-0001.md')).toContain('status: draft');
		expect(vaultFile('Tactics/AAR Template.md')).toContain('After-action review');
	});

	test('an after-action review that says the same twice is refused', async ({ page }) => {
		await page.goto('/tactics/aar');
		await page.getByTestId('aar-happened').fill('It went wrong.');
		await page.getByTestId('aar-did').fill('Peek');
		await page.getByTestId('aar-should').fill('peek');
		await page.getByTestId('aar-tags').fill('bodycam.peek');
		await page.getByTestId('aar-save').click();
		await expect(page.getByTestId('aar-problem')).toContainText('the same');
	});
});
