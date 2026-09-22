import { test, expect } from '@playwright/test';
import { resetVault } from './helpers';

/**
 * Phase 3: the study page's layout, as opposed to what it shows.
 *
 * `11-study.spec.ts` covers the data these widgets render; this file covers
 * the grid that holds them and the phone-specific shape of the review
 * session, both of which changed independently of any widget's content.
 */

/** Round to the nearest few pixels, so sub-pixel layout does not fail a test. */
const bucket = (n: number) => Math.round(n / 8) * 8;

test.describe('the widget grid', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.setViewportSize({ width: 1400, height: 1600 });
		await page.goto('/study');
	});

	test('backfills a hole a span-6 card left behind a full-width one', async ({ page }) => {
		// The study page's own five widgets never fragment a row — four
		// span-6 cards followed by one span-12 divide twelve columns exactly,
		// whatever height each card renders at. A row only fragments, leaving a
		// cell nothing after it can reach, when a span-6 card is immediately
		// followed by a span-12 one: the wide card cannot share that row, so it
		// drops to its own, and only `grid-auto-flow: dense` lets a later
		// span-6 card climb back up and take the six columns the wide card
		// left behind. Proving that needs an order this page does not have, so
		// it is staged directly against the real grid and its real CSS rather
		// than against a fixture whose widget order cannot exercise it.
		const rects = await page.evaluate(() => {
			const grid = document.querySelector('[data-testid="study-grid"]') as HTMLElement;
			grid.innerHTML = '';
			const add = (span: number, height: number) => {
				const el = document.createElement('div');
				el.style.gridColumn = `span ${span}`;
				el.style.height = `${height}px`;
				el.dataset.probe = '';
				grid.appendChild(el);
				return el;
			};
			const first = add(6, 80); // leaves six columns open beside it
			const wide = add(12, 40); // cannot fit there, drops to its own row
			const backfill = add(6, 40); // dense should climb back into the hole
			return [first, wide, backfill].map((el) => el.getBoundingClientRect());
		});
		const [first, wide, backfill] = rects as [DOMRect, DOMRect, DOMRect];

		// The backfilled card sits beside the first one, not under the wide one.
		expect(bucket(backfill.y)).toBe(bucket(first.y));
		expect(backfill.x).toBeGreaterThan(first.x);
		expect(bucket(wide.y)).not.toBe(bucket(first.y));
	});

	test('spans the full row under 960px, one card per line', async ({ page }) => {
		await page.setViewportSize({ width: 900, height: 1200 });
		const boxes = await page.locator('[data-widget]').evaluateAll((els) =>
			els.map((el) => el.getBoundingClientRect().width)
		);
		const gridWidth = (await page.getByTestId('study-grid').boundingBox())!.width;
		for (const width of boxes) {
			expect(width).toBeGreaterThan(gridWidth - 4);
		}
	});
});

test.describe('the study header on a phone', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/study');
	});

	test('the scope select is visible and switches scope', async ({ page }) => {
		const select = page.getByTestId('study-scope');
		await expect(select).toBeVisible();

		await select.selectOption('reading');
		await page.waitForURL(/\?ws=reading$/);
		await expect(page.getByTestId('due-count')).toBeVisible();
	});

	test('does not overflow sideways', async ({ page }) => {
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(1);
	});
});

test.describe('reviewing on a phone', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/study/review');
	});

	test('pins the grades above the tab bar once the card is revealed', async ({ page }) => {
		await page.getByTestId('card').click();
		const grades = page.getByTestId('grades');
		await expect(grades).toBeVisible();

		const box = (await grades.boundingBox())!;
		const bar = (await page.getByTestId('tabbar').boundingBox())!;
		// On screen, not scrolled out of view...
		expect(box.y).toBeGreaterThan(0);
		expect(box.y + box.height).toBeLessThanOrEqual(844);
		// ...and above the bar rather than under it.
		expect(box.y + box.height).toBeLessThanOrEqual(bar.y + 1);

		// Every grade is a real thumb target.
		const targets = grades.locator('button');
		for (let i = 0; i < (await targets.count()); i++) {
			const target = (await targets.nth(i).boundingBox())!;
			expect(target.height).toBeGreaterThanOrEqual(56);
		}
	});

	test('hides the keyboard hints, which a phone has no use for', async ({ page }) => {
		await page.getByTestId('card').click();
		await expect(page.getByTestId('grade-good').locator('em')).toBeHidden();
	});

	test('scrolls a long answer inside the card rather than the page', async ({ page }) => {
		const card = page.getByTestId('card');
		await card.click();
		const overflow = await card.evaluate((el) => getComputedStyle(el).overflowY);
		expect(overflow).toBe('auto');
	});
});
