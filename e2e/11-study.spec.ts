import { test, expect } from '@playwright/test';
import { vaultFile, lineWith, waitForFile, resetVault, TODAY } from './helpers';

/**
 * Phase 5: the study tracker.
 *
 * The fixtures live in `e2e/fixtures/11-study.mjs` and are shaped like the
 * real vault: Spaced Repetition markdown with the plugin's own comments,
 * resource notes whose only frontmatter is a link, and a curriculum written as
 * headings over checkboxes.
 *
 * The card the session opens with is `Study/Flashcards.md`, due three days
 * ago at interval 4 and ease 270. Three days late answered `good` is
 * (4 + 3/2) * 2.7 = 14.85, which rounds to 15 days at ease 270 — the same
 * numbers Obsidian would have written, which is the whole point.
 */

const CARDS = 'Study/Flashcards.md';

/** `YYYY-MM-DD`, `days` on from today, the way the scheduler counts. */
function day(days: number): string {
	const at = new Date(`${TODAY}T00:00:00Z`);
	at.setUTCDate(at.getUTCDate() + days);
	return at.toISOString().slice(0, 10);
}

test.describe('the study dashboard', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/study');
	});

	test('renders every widget of the study tab', async ({ page }) => {
		await expect(page.getByTestId('study-grid')).toBeVisible();
		for (const widget of ['flashcards-due', 'currently-learning', 'queue', 'habits', 'topic-map']) {
			await expect(page.locator(`[data-widget="${widget}"]`)).toBeVisible();
		}
	});

	test('shows the cards due today and a way into the session', async ({ page }) => {
		// One overdue card and two never reviewed; the 2099 one stays out.
		await expect(page.getByTestId('due-count')).toHaveText('3');
		await expect(page.locator('[data-widget="flashcards-due"]')).toContainText('1 due');
		await expect(page.locator('[data-widget="flashcards-due"]')).toContainText('2 new');
		await expect(page.getByTestId('review-link')).toBeVisible();
	});

	test('names the note whose cards Obsidian cannot see', async ({ page }) => {
		const warning = page.getByTestId('invisible');
		await expect(warning).toContainText('Loose');
		await expect(warning).toContainText('#flashcards');
	});

	test('leads the queue with what is already under way', async ({ page }) => {
		// The book has notes written in it, the video is a bare link.
		await expect(page.getByTestId('learning-item')).toContainText('The C Programming Language');
		// Rule 1 of `queue()`, stated in that module: finish what you started.
		// The book is `learning`, so it heads the queue rather than sitting
		// outside it, and the untouched video follows.
		await expect(page.getByTestId('queue-item').first()).toContainText('The C Programming Language');
		await expect(page.getByTestId('queue-item').filter({ hasText: 'Pointers explained' })).toBeVisible();
	});

	test('shows the curriculum as topics, with the untouched one as a gap', async ({ page }) => {
		const map = page.getByTestId('topic-map');
		await expect(map.getByTestId('topic').filter({ hasText: '1. Foundations' })).toHaveAttribute('data-state', 'started');
		await expect(map.getByTestId('topic').filter({ hasText: '2. Systems' })).toHaveAttribute('data-state', 'gap');

		await map.getByTestId('gaps-only').check();
		await expect(map.getByTestId('topic')).toHaveCount(1);
	});

	test('shows today’s habits from the daily note, and ticks one in place', async ({ page }) => {
		const habits = page.getByTestId('habits');
		await expect(habits.getByTestId('habits-score')).toContainText('of 4 done today');
		const row = habits.getByTestId('habit').filter({ hasText: 'Twenty push ups' });

		const before = vaultFile(`Journal/${TODAY.slice(0, 4)}/${TODAY.slice(5, 7)}/${TODAY.slice(8, 10)}.md`).split('\n');
		await row.getByTestId('habit-check').click();

		const note = `Journal/${TODAY.slice(0, 4)}/${TODAY.slice(5, 7)}/${TODAY.slice(8, 10)}.md`;
		expect(await waitForFile(note, (c) => c.includes('- [x] Twenty push ups'))).toBe(true);
		const after = vaultFile(note).split('\n');
		expect(after.map((l, i) => (l === before[i] ? null : i)).filter((i) => i !== null)).toHaveLength(1);
	});

	test('starting a queued resource writes one line of frontmatter', async ({ page }) => {
		const path = 'Study/Resources/Video. Pointers explained.md';
		const before = vaultFile(path).split('\n');
		await page.getByTestId('queue-item').filter({ hasText: 'Pointers explained' }).getByTestId('start').click();

		expect(await waitForFile(path, (c) => c.includes('status: learning'))).toBe(true);
		const after = vaultFile(path).split('\n');
		// Exactly one line added, in the frontmatter, and the body untouched.
		expect(after.filter((l) => !l.startsWith('status:'))).toEqual(before);
		await expect(page.getByTestId('learning-item').filter({ hasText: 'Pointers explained' })).toBeVisible();
	});
});

test.describe('the review session', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/study/review');
	});

	test('opens on the most overdue card, hidden until revealed', async ({ page }) => {
		await expect(page.getByTestId('card-question')).toContainText('What does SM-2 schedule');
		await expect(page.getByTestId('card-answer')).toHaveCount(0);
		await expect(page.getByTestId('card-left')).toHaveText('3 left');

		await page.getByTestId('card').click();
		await expect(page.getByTestId('card-answer')).toContainText('The day a card is next due');
		await expect(page.getByTestId('grades')).toBeVisible();
	});

	test('space reveals and the number keys grade, for a keyboard', async ({ page }) => {
		// Retried: the window key handler exists only once the page has
		// hydrated, and a key pressed a moment early is simply lost. There is
		// nothing to wait for, so the press itself is what repeats.
		await expect(async () => {
			await page.keyboard.press(' ');
			await expect(page.getByTestId('card-answer')).toBeVisible({ timeout: 400 });
		}).toPass({ timeout: 8000 });
		// 3 is Good, in the Again, Hard, Good, Easy order the buttons show.
		await page.keyboard.press('3');
		expect(await waitForFile(CARDS, (c) => c.includes(`,15,270`))).toBe(true);
	});

	test('shows what each grade would do before it is chosen', async ({ page }) => {
		await page.getByTestId('card').click();
		await expect(page.getByTestId('grade-again')).toContainText('today');
		await expect(page.getByTestId('grade-good')).toContainText('15 days');
	});

	test('grading writes the plugin’s own comment and changes nothing else', async ({ page }) => {
		const before = vaultFile(CARDS).split('\n');
		await page.getByTestId('card').click();
		await page.getByTestId('grade-good').click();

		expect(await waitForFile(CARDS, (c) => c.includes(`<!--SR:!${day(15)},15,270-->`))).toBe(true);
		const after = vaultFile(CARDS).split('\n');
		const changed = after.map((l, i) => (l === before[i] ? null : i)).filter((i) => i !== null);
		expect(changed).toHaveLength(1);
		expect(after[changed[0]!]).toBe(`<!--SR:!${day(15)},15,270-->`);
	});

	test('the graded card leaves the queue and the next one arrives', async ({ page }) => {
		await page.getByTestId('card').click();
		await page.getByTestId('grade-good').click();

		await expect(page.getByTestId('card-question')).not.toContainText('What does SM-2 schedule');
		await expect(page.getByTestId('card-left')).toHaveText('2 left');

		// And it is gone from the dashboard's count, because the file changed.
		await page.goto('/study');
		await expect(page.getByTestId('due-count')).toHaveText('2');
	});

	test('a card with no schedule gains one line, inserted after it', async ({ page }) => {
		const before = vaultFile(CARDS).split('\n');
		// Clear the overdue one first so the new card comes up.
		await page.getByTestId('card').click();
		await page.getByTestId('grade-good').click();
		await expect(page.getByTestId('card-question')).toContainText('Which plugin owns the comment format');

		await page.getByTestId('card').click();
		await page.getByTestId('grade-easy').click();

		const line = 'Which plugin owns the comment format::Obsidian Spaced Repetition';
		const at = before.indexOf(line) + 1;
		expect(await waitForFile(CARDS, (c) => (c.split('\n')[at] ?? '').startsWith('<!--SR:'))).toBe(true);
		const after = vaultFile(CARDS).split('\n');
		expect(after).toHaveLength(before.length + 1);
		// New card, easy: one day at base ease, plus the bonus, is four days.
		expect(after[at]).toBe(`<!--SR:!${day(4)},4,270-->`);
	});

	test('answering again brings the card back before the session ends', async ({ page }) => {
		await page.getByTestId('card').click();
		await page.getByTestId('grade-again').click();
		await expect(page.getByTestId('card-question')).not.toContainText('What does SM-2 schedule');

		// Due today, so the file says so and the card is still in the session.
		expect(await waitForFile(CARDS, (c) => c.includes(`<!--SR:!${TODAY},0,250-->`))).toBe(true);
		await expect(page.getByTestId('card-left')).toHaveText('3 left');
	});

	test('finishes cleanly rather than leaving an empty card', async ({ page }) => {
		for (let i = 0; i < 3; i++) {
			await page.getByTestId('card').click();
			await page.getByTestId('grade-good').click();
		}
		await expect(page.getByTestId('review-done')).toContainText('Done for today');
		await expect(page.getByTestId('review-done')).toContainText('3 answers');
	});

	test('says so plainly when nothing is due', async ({ page }) => {
		await page.goto('/study/review?ws=work');
		await expect(page.getByTestId('nothing-due')).toContainText('Nothing due');
	});

	test('works on a phone, where the whole session must fit', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 780 });
		await page.goto('/study/review');

		await page.getByTestId('card').click();
		const grades = page.getByTestId('grades');
		await expect(grades).toBeVisible();

		const box = await grades.boundingBox();
		expect(box!.width).toBeLessThanOrEqual(390);
		// Four targets across, each still wide enough for a thumb.
		expect(box!.width / 4).toBeGreaterThan(44);

		await page.getByTestId('grade-good').click();
		expect(await waitForFile(CARDS, (c) => c.includes(',15,270'))).toBe(true);
	});
});

test.describe('the same widgets somewhere that is not the study page', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/w/reading');
	});

	test('render on an ordinary workspace tab, scoped to that workspace', async ({ page }) => {
		for (const widget of ['currently-learning', 'queue', 'flashcards-due', 'topic-map', 'habits']) {
			await expect(page.locator(`[data-widget="${widget}"]`)).toBeVisible();
		}
		// Reading's own card, not the study one, because the scope is the folder.
		await expect(page.getByTestId('due-count')).toHaveText('1');
		await expect(page.getByTestId('queue-item')).toContainText('How to read a book');
		await expect(page.locator('[data-widget="queue"]')).not.toContainText('Pointers explained');
	});

	test('review from a workspace stays inside that workspace', async ({ page }) => {
		await page.getByTestId('review-link').click();
		await expect(page).toHaveURL(/\/study\/review\?ws=reading$/);
		await expect(page.getByTestId('card-question')).toContainText('A Philosophy of Software Design');
		await expect(page.getByTestId('card-left')).toHaveText('1 left');
	});

	test('habits are the same wherever the widget sits, since habits are daily', async ({ page }) => {
		await expect(page.getByTestId('habits-score')).toContainText('of 4 done today');
	});
});

test.describe('the Anki export', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('downloads a deck in the format the old exports use', async ({ request }) => {
		const response = await request.get('/api/study/card?deck=Study&folder=Study');
		expect(response.status()).toBe(200);
		expect(response.headers()['content-disposition']).toContain('Study.txt');

		const body = await response.text();
		expect(body.split('\n').slice(0, 3)).toEqual(['#separator:Tab', '#html:true', '#deck:Study']);
		expect(body).toContain('What does SM-2 schedule\tThe day a card is next due');
		// The schedule is Obsidian's business, not Anki's.
		expect(body).not.toContain('SR:');
	});

	test('never writes into the vault, least of all into Flashcards/', async ({ request }) => {
		const before = vaultFile(CARDS);
		await request.get('/api/study/card?deck=Study&folder=Study');
		expect(vaultFile(CARDS)).toBe(before);
		expect(vaultFile('Flashcards/Study.txt')).toBe('');
	});
});

test.describe('refusing to clobber Obsidian', () => {
	test.beforeEach(async ({ request }) => {
		await resetVault(request);
	});

	test('rejects a grade aimed at a line that has since changed', async ({ request }) => {
		const { index } = lineWith(CARDS, 'What does SM-2 schedule');
		const response = await request.post('/api/study/card', {
			data: {
				path: CARDS,
				line: index,
				index: 0,
				expectedRaw: '<!--SR:!1999-01-01,1,250-->',
				grade: 'good'
			}
		});
		expect(response.status()).toBe(409);
		expect(vaultFile(CARDS)).toContain(`<!--SR:!${day(-3)},4,270-->`);
	});

	test('rejects a grade that is not one of the four', async ({ request }) => {
		const { index } = lineWith(CARDS, 'What does SM-2 schedule');
		const response = await request.post('/api/study/card', {
			data: { path: CARDS, line: index, index: 0, grade: 'brilliant' }
		});
		expect(response.status()).toBe(400);
	});

	test('rejects a status the vault has no meaning for', async ({ request }) => {
		const response = await request.post('/api/study/resource', {
			data: { path: 'Study/Resources/Video. Pointers explained.md', status: 'nearly' }
		});
		expect(response.status()).toBe(422);
		expect(vaultFile('Study/Resources/Video. Pointers explained.md')).not.toContain('status:');
	});
});
