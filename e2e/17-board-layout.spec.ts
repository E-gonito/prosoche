import { test, expect, type Page } from '@playwright/test';
import { resetVault, vaultFile, waitForFile } from './helpers';

/**
 * Phase 6: the shape of the board, as opposed to what it puts on it.
 *
 * `08-workspaces.spec.ts` proves the board reads the right markdown and writes
 * the right bytes back. This file is about the five columns that used to run
 * off the right of a 1400px screen with the fifth cut through the middle of a
 * word, the column select that used to sit open on every card, and the add
 * form that used to sit open on every column including the empty ones. None
 * of that changes a file, so none of it belongs in 08.
 */

const DECK = 'Work/Atlas/Tasks.md';

/**
 * Where each column ends, in the scroller's own content coordinates, next to
 * how much of that content the scroller can show. Measured in one round trip
 * so the numbers all come from the same layout.
 */
async function geometry(page: Page) {
	return page.evaluate(() => {
		const board = document.querySelector('[data-testid="board"]') as HTMLElement;
		const box = board.getBoundingClientRect();
		return {
			clientWidth: board.clientWidth,
			scrollWidth: board.scrollWidth,
			columns: [...board.querySelectorAll('[data-testid="column"]')].map((column) => {
				const rect = column.getBoundingClientRect();
				return {
					key: (column as HTMLElement).dataset.column ?? '',
					left: rect.left - box.left + board.scrollLeft,
					right: rect.right - box.left + board.scrollLeft,
					width: rect.width
				};
			})
		};
	});
}

test.describe('the columns of a board at 1400px', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		// Work takes the five default status columns and has no cards of its
		// own, every task under it belonging to Atlas. That is the board the
		// five-column overflow was found on.
		await page.goto('/w/work');
		await expect(page.getByTestId('column').first()).toBeVisible();
	});

	test('parks the finished columns it has nothing in, and brings them back', async ({ page }) => {
		await expect(page.getByTestId('column')).toHaveText([/To do/, /In progress/, /Blocked/]);

		const toggle = page.getByTestId('show-finished');
		await expect(toggle).toHaveText('Show finished (2)');
		await toggle.click();

		await expect(page.getByTestId('column')).toHaveCount(5);
		await expect(page.locator('[data-testid="column"][data-column="cancelled"]')).toBeVisible();
		await expect(toggle).toHaveText('Hide finished');
	});

	test('remembers that choice on this device, so it is not made twice', async ({ page }) => {
		await page.getByTestId('show-finished').click();
		await expect(page.getByTestId('column')).toHaveCount(5);

		await page.reload();
		await expect(page.getByTestId('column')).toHaveCount(5);
		expect(await page.evaluate(() => localStorage.getItem('hub:board-finished'))).toBe('1');
	});

	test('fits its columns across the widget rather than clipping the last one', async ({ page }) => {
		const before = await geometry(page);
		// Three columns, sharing the row: nothing is out of sight at all.
		expect(before.scrollWidth).toBeLessThanOrEqual(before.clientWidth + 1);
		for (const column of before.columns) {
			expect(column.right).toBeLessThanOrEqual(before.clientWidth + 1);
			expect(column.width).toBeGreaterThanOrEqual(220);
		}

		await page.getByTestId('show-finished').click();
		await expect(page.getByTestId('column')).toHaveCount(5);
		const after = await geometry(page);

		// Every column is whole inside the scrollable content, whether or not
		// all five fit at once: a column is never cut off, only scrolled past.
		expect(after.columns).toHaveLength(5);
		for (const column of after.columns) {
			expect(column.right).toBeLessThanOrEqual(after.scrollWidth + 1);
			expect(column.width).toBeGreaterThanOrEqual(220);
		}

		// And when they do not all fit, the right edge says so.
		const overflows = after.scrollWidth > after.clientWidth + 1;
		await expect(page.getByTestId('board-deck')).toHaveAttribute('data-more', String(overflows));
	});
});

test.describe('the column select on a pointer device', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/w/atlas');
	});

	test('stays out of the way until the card is hovered', async ({ page }) => {
		const card = page.getByTestId('card').filter({ hasText: 'Ship the release' });
		const select = card.getByTestId('move-card');
		await expect(card).toBeVisible();
		await expect(select).toBeHidden();

		await card.hover();
		await expect(select).toBeVisible();

		await page.mouse.move(2, 2);
		await expect(select).toBeHidden();
	});

	test('the more button pins it open, for anyone not using a mouse', async ({ page }) => {
		const card = page.getByTestId('card').filter({ hasText: 'Ship the release' });
		const select = card.getByTestId('move-card');

		await card.getByTestId('card-more').click();
		// Take the focus and the pointer off the card: neither is what is
		// holding the select open now.
		await page.getByTestId('workspace-name').click();
		await page.mouse.move(2, 2);
		await expect(select).toBeVisible();

		await card.getByTestId('card-more').click();
		await page.getByTestId('workspace-name').click();
		await page.mouse.move(2, 2);
		await expect(select).toBeHidden();
	});

	test('keyboard focus anywhere on the card is enough to reveal it', async ({ page }) => {
		const card = page.getByTestId('card').filter({ hasText: 'Ship the release' });
		await card.getByTestId('card-more').focus();
		await page.mouse.move(2, 2);
		await expect(card.getByTestId('move-card')).toBeVisible();
	});
});

test.describe('the column select on a touch device', () => {
	// Wide enough that the phone layout is not what is showing it: only
	// `(hover: none)` can be, which is the point.
	test.use({ isMobile: true, hasTouch: true, viewport: { width: 900, height: 900 } });

	test('is always out, because there is no hover to ask with', async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/w/atlas');
		const card = page.getByTestId('card').filter({ hasText: 'Ship the release' });
		await expect(card).toBeVisible();
		await expect(card.getByTestId('move-card')).toBeVisible();
		await expect(card.getByTestId('card-more')).toBeHidden();
	});
});

test.describe('one add affordance per column', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/w/atlas');
		await expect(page.getByTestId('column').first()).toBeVisible();
	});

	test('a column shows a button, not a form, until the button is pressed', async ({ page }) => {
		await expect(page.getByTestId('new-card')).toHaveCount(0);
		await expect(page.getByTestId('add-card-open')).toHaveCount(4);

		const column = page.locator('[data-column="review"]');
		await column.getByTestId('add-card-open').click();
		const input = column.getByTestId('new-card');
		await expect(input).toBeFocused();

		// Only the one column opens; the others stay as buttons.
		await expect(page.getByTestId('new-card')).toHaveCount(1);

		await input.press('Escape');
		await expect(page.getByTestId('new-card')).toHaveCount(0);
		await expect(column.getByTestId('add-card-open')).toBeVisible();
	});

	test('adding from it appends one line to the deck', async ({ page }) => {
		const before = vaultFile(DECK);
		const column = page.locator('[data-column="to-do"]');
		await column.getByTestId('add-card-open').click();
		await column.getByTestId('new-card').fill('Book the anonymisation review');
		await column.getByTestId('add-card').click();

		expect(await waitForFile(DECK, (c) => c.includes('Book the anonymisation review'))).toBe(true);
		const after = vaultFile(DECK);
		expect(after.startsWith(before)).toBe(true);
		expect(after.slice(before.length)).toBe('- [ ] Book the anonymisation review #ws/atlas\n');
		await expect(column.getByTestId('card').filter({ hasText: 'Book the anonymisation review' })).toHaveCount(1);
	});
});

test.describe('a board on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.goto('/w/atlas');
		await expect(page.getByTestId('column-pills')).toBeVisible();
	});

	test('names every column in a pill big enough to hit', async ({ page }) => {
		const pills = page.getByTestId('column-pill');
		await expect(pills).toHaveCount(4);
		await expect(pills.first()).toHaveText(/To do4/);
		for (const box of await pills.all()) {
			expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(40);
		}
		// The pills scroll inside themselves rather than widening the page.
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(1);
	});

	test('tapping a pill brings its column to the front', async ({ page }) => {
		const review = page.getByTestId('column-pill').filter({ hasText: 'Review' });
		await expect(page.getByTestId('column-pill').first()).toHaveAttribute('aria-current', 'true');

		await review.click();
		await expect(review).toHaveAttribute('aria-current', 'true');
		await expect(page.getByTestId('column-pill').first()).not.toHaveAttribute('aria-current', 'true');

		// The column itself is what moved, to the left edge of the scroller.
		await expect
			.poll(async () => {
				const { columns } = await geometry(page);
				const left = await page.evaluate(
					() => (document.querySelector('[data-testid="board"]') as HTMLElement).scrollLeft
				);
				return Math.round(columns.find((c) => c.key === 'review')!.left - left);
			})
			.toBeLessThanOrEqual(2);
	});

	test('scrolling the board moves the highlight without being tapped', async ({ page }) => {
		await page.evaluate(() => {
			const board = document.querySelector('[data-testid="board"]') as HTMLElement;
			const column = board.querySelector('[data-column="done"]') as HTMLElement;
			board.scrollLeft = column.offsetLeft - (board.querySelector('[data-column="to-do"]') as HTMLElement).offsetLeft;
		});
		await expect(page.getByTestId('column-pill').filter({ hasText: 'Done' })).toHaveAttribute('aria-current', 'true');
	});
});
