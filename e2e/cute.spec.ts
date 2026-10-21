import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { resetVault, VAULT, vaultFile } from './helpers';

/**
 * Cute, against a `Cute/` written here: one character, Yaku Neko, whose note
 * is the real one's shape (two embeds on one line, and a half-broken Reddit
 * link) with its two images.
 */

const NOTE = '![[Pasted image 1.png]]![[Pasted image 2.png]]\n[![Yaku Neko : r/ChainsmokerCat](https://i.redd.it/gnzt3w58o3ih1.jpg)\n';

const png = (w: number, h: number, noise = false) =>
	noise
		? sharp(Buffer.from(Array.from({ length: w * h * 3 }, () => Math.floor(Math.random() * 256))), { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
		: sharp({ create: { width: w, height: h, channels: 3, background: '#e6a' } }).png().toBuffer();

const images = () => readdirSync(join(VAULT, 'Cute/images')).sort();

/** Hand the page an image the way a paste or a drop does, from its bytes. */
async function deliver(page: Page, how: 'paste' | 'drop', bytes: Buffer, type = 'image/png') {
	await page.evaluate(
		({ how, data, type }) => {
			const file = new File([new Uint8Array(data)], 'clip.png', { type });
			const dt = new DataTransfer();
			dt.items.add(file);
			if (how === 'paste') window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
			else document.querySelector('[data-testid="drop"]')!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
		},
		{ how, data: [...bytes], type }
	);
}

test.describe('Cute', () => {
	test.beforeEach(async ({ page, request }) => {
		await resetVault(request);
		mkdirSync(join(VAULT, 'Cute/images'), { recursive: true });
		writeFileSync(join(VAULT, 'Cute/Yaku Neko.md'), NOTE);
		writeFileSync(join(VAULT, 'Cute/images/Pasted image 1.png'), await png(4, 4));
		writeFileSync(join(VAULT, 'Cute/images/Pasted image 2.png'), await png(4, 4));
		await request.post('/api/sync', { data: { action: 'rebuild' } });
		await page.goto('/cute');
	});

	test('shows each character with its cover and count, and none of the grid is a choice until there is an image', async ({ page }) => {
		const tile = page.getByTestId('character');
		await expect(tile).toHaveCount(1);
		await expect(tile).toContainText('Yaku Neko');
		await expect(tile).toContainText('3 images');
		await expect(page.getByTestId('add-here')).toHaveCount(0);
		await expect(page.getByTestId('sub-cute')).toContainText('Yaku Neko');
	});

	test('a pasted screenshot is filed as WebP to the tapped character, adding one line to its note', async ({ page }) => {
		await deliver(page, 'paste', await png(40, 30));
		await expect(page.getByTestId('preview')).toBeVisible();
		await expect(page.getByTestId('still-hint')).toBeVisible();
		await page.getByTestId('add-here').filter({ hasText: 'Yaku Neko' }).click();

		await expect(page.getByTestId('filed')).toContainText('Added to Yaku Neko');
		const added = images().filter((n) => n.startsWith('Yaku Neko '));
		expect(added).toHaveLength(1);
		expect(added[0]).toMatch(/^Yaku Neko \d{8}-\d{6}\.webp$/);
		expect(vaultFile('Cute/Yaku Neko.md')).toBe(`${NOTE}![[${added[0]}]]\n`);

		const served = await page.request.get(`/cute/media/${encodeURIComponent(added[0])}`);
		expect(served.headers()['content-type']).toBe('image/webp');
		await expect(page.getByTestId('character')).toContainText('4 images');
	});

	test('a dropped GIF is kept as it is, and a new character is made for it', async ({ page }) => {
		const gif = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#39f' } }).gif().toBuffer();
		await deliver(page, 'drop', gif, 'image/gif');
		await expect(page.getByTestId('still-hint')).toHaveCount(0);
		await page.getByTestId('new-character').fill('Pusheen');
		await page.getByTestId('create-character').click();

		await expect(page.getByTestId('filed')).toContainText('Added to Pusheen');
		const [file] = images().filter((n) => n.startsWith('Pusheen '));
		expect(file).toMatch(/\.gif$/);
		expect(vaultFile('Cute/Pusheen.md')).toBe(`![[${file}]]\n`);
		await expect(page.getByTestId('character').first()).toContainText('Pusheen');
	});

	test('a file chosen over the old 512 KB limit is taken', async ({ page }) => {
		const big = await png(700, 700, true);
		expect(big.length).toBeGreaterThan(600 * 1024);
		await page.getByTestId('file-input').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: big });
		await page.getByTestId('add-here').first().click();
		await expect(page.getByTestId('filed')).toContainText('Added to Yaku Neko');
	});

	test('Cancel and a name already taken write nothing', async ({ page }) => {
		const before = images();
		await deliver(page, 'paste', await png(10, 10));
		await page.getByTestId('cancel').click();
		await expect(page.getByTestId('preview')).toHaveCount(0);

		await deliver(page, 'paste', await png(10, 10));
		await page.getByTestId('new-character').fill('yaku neko');
		await page.getByTestId('create-character').click();
		await expect(page.getByTestId('cute-problem')).toContainText('already a character called');
		expect(images()).toEqual(before);
		expect(vaultFile('Cute/Yaku Neko.md')).toBe(NOTE);
	});

	test('a character’s page shows every picture newest first, the web one included, and opens one full size', async ({ page }) => {
		await page.getByTestId('character').click();
		await expect(page).toHaveURL('/cute/yaku-neko');
		const pictures = page.getByTestId('picture');
		await expect(pictures).toHaveCount(3);
		await expect(pictures.first().locator('img')).toHaveAttribute('src', 'https://i.redd.it/gnzt3w58o3ih1.jpg');
		await pictures.nth(1).click();
		await expect(page.getByTestId('viewer')).toBeVisible();
		await expect(page.getByTestId('viewer').locator('img')).toHaveAttribute('src', '/cute/media/Pasted%20image%202.png');
		await page.getByTestId('close-viewer').click();
		await expect(page.getByTestId('viewer')).not.toBeVisible();
	});

	test('the media route serves only images in Cute/images', async ({ page }) => {
		expect((await page.request.get('/cute/media/Pasted%20image%201.png')).status()).toBe(200);
		expect((await page.request.get('/cute/media/..%2FYaku%20Neko.md')).status()).toBe(404);
		expect((await page.request.get('/cute/media/Yaku%20Neko.md')).status()).toBe(404);
	});
});
