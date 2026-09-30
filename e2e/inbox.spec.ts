import { test, expect } from '@playwright/test';
import { TODAY, TODAY_NOTE, centre, dragTo, resetVault, vaultFile, waitForFile } from './helpers';

/** Mirrors `e2e/fixtures/inbox.mjs`. */
const CAPTURE = 'Inbox/Capture.md';

function shiftDay(day: string, offset: number): string {
	const [y, m, d] = day.split('-').map(Number);
	const date = new Date(y, m - 1, d + offset);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Which lines differ between two versions of a file, by index. */
function changedLines(before: string, after: string): number[] {
	const a = before.split('\n');
	const b = after.split('\n');
	return b.map((line, i) => (line === a[i] ? null : i)).filter((i): i is number => i !== null);
}

test.beforeEach(async ({ request }) => await resetVault(request));

test.describe("Today's note", () => {
	test('a day with no note offers to create it, and the note is the template byte for byte', async ({ page, request }) => {
		const day = shiftDay(TODAY, 1);
		const path = `Journal/${day.slice(0, 4)}/${day.slice(5, 7)}/${day.slice(8, 10)}.md`;
		expect(vaultFile(path)).toBe('');

		await page.goto(`/today/${day}`);
		await expect(page.getByTestId('no-note')).toContainText(path);
		await page.getByTestId('create-note').click();

		expect(await waitForFile(path, (c) => c.length > 0)).toBe(true);
		expect(vaultFile(path)).toBe(vaultFile('Journal/Journal Template.md'));
		await expect(page.getByTestId('unscheduled')).toContainText('Twenty push ups');

		// A second press, from anywhere, never overwrites what is there now.
		const before = vaultFile(TODAY_NOTE);
		const again = await request.post(`/api/day/${TODAY}/note`, { data: {} });
		expect(again.status()).toBe(409);
		expect(vaultFile(TODAY_NOTE)).toBe(before);
	});
});

test.describe('Board cards on Today', () => {
	test('dragging a card onto the timeline adds one block to the day and leaves Board.md alone', async ({ page }) => {
		const board = vaultFile('Work/Board.md');
		const note = vaultFile(TODAY_NOTE);
		await page.goto('/today');

		const row = page.getByTestId('today-workspaces').getByTestId('board-card-row').filter({ hasText: 'Book the venue' });
		const grip = await row.getByTestId('card-grip').boundingBox();
		const target = await centre(page, '[data-testid="timeline-scroll"]');
		await dragTo(page, { x: grip!.x + grip!.width / 2, y: grip!.y + grip!.height / 2 }, target);

		expect(await waitForFile(TODAY_NOTE, (c) => c.includes('Book the venue'))).toBe(true);
		const after = vaultFile(TODAY_NOTE);
		const changed = changedLines(note, after);
		expect(after.split('\n').length).toBe(note.split('\n').length + 1);
		expect(after.split('\n')[changed[0]]).toMatch(/^- \[ \] \d{2}:\d{2} - \d{2}:\d{2} Book the venue \[\[Work\/Board\]\] #ws\/work$/);
		expect(vaultFile('Work/Board.md')).toBe(board);
		await expect(page.getByTestId('block').filter({ hasText: 'Book the venue' })).toBeVisible();
	});
});

test.describe('Capture routing', () => {
	const todayBox = (page: import('@playwright/test').Page) => page.getByTestId('unscheduled').getByTestId('capture-row');
	const notesBox = (page: import('@playwright/test').Page) => page.getByTestId('capture-row');

	test('the box on Today adds a task to the day’s unscheduled list', async ({ page }) => {
		const inbox = vaultFile(CAPTURE);
		await page.goto('/today');
		await todayBox(page).getByLabel('Quick capture').fill('Buy stamps');
		await todayBox(page).getByRole('button', { name: 'Add' }).click();
		await expect(page.getByText("Added to today's unscheduled list")).toBeVisible();
		expect(vaultFile(TODAY_NOTE)).toContain('\n- [ ] Buy stamps\n## Backlog');
		expect(vaultFile(CAPTURE)).toBe(inbox);
		await expect(page.getByTestId('unscheduled').getByTestId('task-row').filter({ hasText: 'Buy stamps' })).toBeVisible();
	});

	test('a time range typed on Today goes straight onto the timeline', async ({ page }) => {
		const inbox = vaultFile(CAPTURE);
		await page.goto('/today');
		await todayBox(page).getByLabel('Quick capture').fill('16:00 - 16:30 Call the bank');
		await todayBox(page).getByRole('button', { name: 'Add' }).click();
		await expect(page.getByText('Added to today, 16:00–16:30')).toBeVisible();
		expect(vaultFile(TODAY_NOTE)).toContain('\n- [ ] 16:00 - 16:30 Call the bank\n## Backlog');
		expect(vaultFile(CAPTURE)).toBe(inbox);
		await expect(page.getByTestId('block').filter({ hasText: 'Call the bank' })).toBeVisible();
	});

	test('a workspace tag, from any other box, goes onto that board', async ({ page }) => {
		const inbox = vaultFile(CAPTURE);
		await page.goto('/notes');
		await notesBox(page).getByLabel('Quick capture').fill('Order the banners #ws/work');
		await notesBox(page).getByRole('button', { name: 'Add' }).click();
		await expect(page.getByText("Added to Work's board")).toBeVisible();
		expect(vaultFile('Work/Board.md')).toContain('- [ ] Book the venue\n- [ ] Order the banners\n');
		expect(vaultFile(CAPTURE)).toBe(inbox);
	});

	test('anything else lands in the inbox and shows on the Inbox card', async ({ page }) => {
		await page.goto('/notes');
		await notesBox(page).getByLabel('Quick capture').fill('buy a birthday card');
		await notesBox(page).getByRole('button', { name: 'Add' }).click();
		await expect(page.getByText('Saved to Inbox/Capture.md')).toBeVisible();
		expect(vaultFile(CAPTURE)).toMatch(new RegExp(`## ${TODAY}\\n(- .*\\n)*- \\d{2}:\\d{2} buy a birthday card\\n`));
		await page.goto('/today');
		await expect(page.getByTestId('today-inbox').locator('.inbox-line').first()).toContainText('buy a birthday card');
	});
});

test.describe('Inbox', () => {
	test('Today shows the newest unfiled captures, a count and a link to triage', async ({ page }) => {
		await page.goto('/today');
		const card = page.getByTestId('today-inbox');
		await expect(card.locator('.inbox-line')).toHaveText([
			'09:30 Look into a standing desk',
			'Buy stamps',
			'09:05 Call the printer #ws/work',
			'08:10 Renew the passport'
		]);
		await card.getByRole('link', { name: '4 to triage' }).click();
		await expect(page).toHaveURL(/\/inbox$/);
		await expect(page.getByTestId('inbox-row')).toHaveCount(4);
	});

	test('the card keeps its capture box once the inbox is empty, and loses its list and count', async ({ page }) => {
		await page.goto('/inbox');
		for (let i = 0; i < 4; i++) {
			await page.getByTestId('inbox-row').first().focus();
			await page.keyboard.press('x');
			await expect(page.getByTestId('inbox-row')).toHaveCount(3 - i);
		}
		await expect(page.getByTestId('inbox-empty')).toBeVisible();
		await page.goto('/today');
		const card = page.getByTestId('today-inbox');
		await expect(card.getByTestId('capture-row')).toBeVisible();
		await expect(card.locator('.inbox-line')).toHaveCount(0);
		await expect(card.getByRole('link')).toHaveCount(0);
	});

	test('the Inbox card’s box on Today captures a thought into the inbox, not the day', async ({ page }) => {
		const note = vaultFile(TODAY_NOTE);
		await page.goto('/today');
		const box = page.getByTestId('today-inbox').getByTestId('capture-row');
		await box.getByLabel('Quick capture').fill('remember the umbrella');
		await box.getByRole('button', { name: 'Add' }).click();
		await expect(page.getByText('Saved to Inbox/Capture.md')).toBeVisible();
		await expect(page.getByTestId('today-inbox').locator('.inbox-line').first()).toContainText('remember the umbrella');
		expect(vaultFile(TODAY_NOTE)).toBe(note);
	});

	test('x drops a line: one character on one line, nothing deleted', async ({ page }) => {
		const before = vaultFile(CAPTURE);
		await page.goto('/inbox');
		await page.getByTestId('inbox-row').filter({ hasText: 'Renew the passport' }).focus();
		await page.keyboard.press('x');
		await expect(page.getByTestId('inbox-row')).toHaveCount(3);
		expect(vaultFile(CAPTURE)).toBe(before.replace('- 08:10 Renew the passport', '- [x] 08:10 Renew the passport'));
	});

	test('t plans a line onto today and ticks it, without the app’s own t', async ({ page }) => {
		const before = vaultFile(CAPTURE);
		const note = vaultFile(TODAY_NOTE);
		await page.goto('/inbox');
		await page.getByTestId('inbox-row').filter({ hasText: 'standing desk' }).focus();
		await page.keyboard.press('t');
		await expect(page.getByTestId('inbox-row')).toHaveCount(3);
		await expect(page).toHaveURL(/\/inbox$/);

		expect(vaultFile(CAPTURE)).toBe(before.replace('- 09:30 Look into', '- [x] 09:30 Look into'));
		const after = vaultFile(TODAY_NOTE);
		expect(after).toBe(note.replace('\n## Backlog', '\n- [ ] Look into a standing desk [[Inbox/Capture]]\n## Backlog'));
	});

	test('b files a line on the board it names, and ticks it', async ({ page }) => {
		const before = vaultFile(CAPTURE);
		await page.goto('/inbox');
		await page.getByTestId('inbox-row').filter({ hasText: 'Call the printer' }).focus();
		await page.keyboard.press('b');
		const picker = page.getByTestId('inbox-picker');
		await expect(picker.getByRole('button').first()).toHaveText('Work');
		await expect(picker.getByRole('button').first()).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('inbox-row')).toHaveCount(3);

		expect(vaultFile('Work/Board.md')).toContain('- [ ] Book the venue\n- [ ] Call the printer\n');
		expect(vaultFile(CAPTURE)).toBe(before.replace('- 09:05 Call the printer', '- [x] 09:05 Call the printer'));
	});

	test('n appends a line to the Overview.md of the workspace picked, and ticks it', async ({ page }) => {
		const before = vaultFile(CAPTURE);
		await page.goto('/inbox');
		await page.getByTestId('inbox-row').filter({ hasText: 'Call the printer' }).focus();
		await page.keyboard.press('n');
		const picker = page.getByTestId('inbox-picker');
		await expect(picker).toHaveAttribute('aria-label', 'Which Overview');
		await expect(picker.getByRole('button').first()).toHaveText('Work');
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('inbox-row')).toHaveCount(3);

		expect(vaultFile('Work/Overview.md')).toMatch(/- Call the printer\n$/);
		expect(vaultFile(CAPTURE)).toBe(before.replace('- 09:05 Call the printer', '- [x] 09:05 Call the printer'));
	});

	test('a workspace’s Inbox tab is the inbox filtered to it, and its capture is tagged', async ({ page }) => {
		await page.goto('/w/work/inbox');
		await expect(page.getByTestId('inbox-row')).toHaveCount(1);
		await expect(page.getByTestId('inbox-row')).toContainText('Call the printer');

		await page.getByLabel('Quick capture').fill('Proof the leaflets');
		await page.getByRole('button', { name: 'Add' }).click();
		await expect(page.getByText('Saved to Inbox/Capture.md')).toBeVisible();
		expect(vaultFile(CAPTURE)).toMatch(/- \d{2}:\d{2} Proof the leaflets #ws\/work\n/);
		expect(vaultFile('Work/Inbox.md')).toBe('');
		await expect(page.getByTestId('inbox-row')).toHaveCount(2);
	});
});
