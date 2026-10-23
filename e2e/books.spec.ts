import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetVault, TODAY, VAULT, vaultFile } from './helpers';
import { makePdf } from './fixtures/make-pdf.mjs';
import { makeEpub } from './fixtures/make-epub.mjs';

/**
 * Books, end to end: add a PDF, an EPUB and a saved site through the Books
 * tab, read them, leave and come back to the same place, search, highlight,
 * remove the files and add them again, checking the book's note in the vault
 * byte for byte wherever the app writes it.
 *
 * The tests share one vault and one shelf and run in order: the PDF is added
 * by the first test and every later PDF test builds on it. The frame itself
 * (sandbox, CSP, bridge) is proved in `book-frame.spec.ts`; here the frame is
 * only the thing a book is read in.
 */

test.describe.configure({ mode: 'serial' });

const ROOT = process.env.E2E_ROOT ?? '/tmp/prosoche-e2e';
const SHELF = `${ROOT}/books`;
const SITE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/site');

// ---- The books ------------------------------------------------------------------------------

const PDF_TITLE = 'Lantern Anatomy';
const PDF_NAME = 'lantern-anatomy.pdf';
const PDF_NOTE = `Books/${PDF_TITLE}.md`;
/** The sentence on page 14 that the highlight test selects, and the word only page 22 has. */
const QUOTE = 'Capillary action carries oil up the wick.';
const RARE_WORD = 'quasar';

const pdfBytes = Buffer.from(
	makePdf(
		Array.from({ length: 30 }, (_, i) => {
			const n = i + 1;
			const extra = n === 14 ? `\n\n${QUOTE}` : n === 22 ? `\n\nA ${RARE_WORD} is far brighter than any lantern.` : '';
			return `Marker for page ${n}.\n\nThe lantern keeps burning on page ${n}.${extra}`;
		}),
		{
			title: PDF_TITLE,
			outline: [
				{ title: 'Chapter One: Light', page: 1 },
				{ title: 'Chapter Two: Oil', page: 8 },
				{ title: 'Chapter Three: Wicks', page: 14 },
				{ title: 'Section 3.1: Trimming', page: 16, depth: 1 },
				{ title: 'Chapter Four: Glass', page: 25 }
			]
		}
	)
);
const PDF_ID = createHash('sha256').update(pdfBytes).digest('hex').slice(0, 16);

const EPUB_TITLE = 'Tiny Tales';
const epubBytes = Buffer.from(makeEpub({ title: EPUB_TITLE }));
const EPUB_ID = createHash('sha256').update(epubBytes).digest('hex').slice(0, 16);

// ---- Helpers --------------------------------------------------------------------------------

const pdfFile = { name: PDF_NAME, mimeType: 'application/pdf', buffer: pdfBytes };

/** Open the Books tab once the page has hydrated, so the file input's handler exists. */
async function openBooks(page: Page) {
	await page.goto('/books', { waitUntil: 'networkidle' });
}

/** The card of the book called `title` on the Books tab. */
const card = (page: Page, title: string) => page.getByTestId('book').filter({ has: page.locator('.name', { hasText: title }) });

/** Wait until the server has pulled a book's text out, which the cards stop mentioning when done. */
async function waitIndexed(request: APIRequestContext, id: string) {
	await expect
		.poll(async () => ((await (await request.get('/api/books')).json()).books as { id: string; text?: { state: string } }[]).find((b) => b.id === id)?.text?.state, { timeout: 20_000, message: 'text indexing to finish' })
		.toBe('done');
}

/** The reader's page label, e.g. `p. 14 of 30`. */
const label = (page: Page) => page.getByTestId('place-label');

/** Wait for the note to hold `pattern` (the place is saved a few seconds after the last move). */
async function noteMatches(path: string, pattern: RegExp, timeout = 10_000) {
	await expect.poll(() => pattern.test(vaultFile(path)), { timeout, message: `${path} to match ${pattern}` }).toBe(true);
}

/** Open a PDF at a page and wait for that page's text layer to be drawn. */
async function openPdf(page: Page, at?: number) {
	await page.goto(`/books/${PDF_ID}${at ? `?at=${encodeURIComponent(`p. ${at}`)}` : ''}`);
	await expect(page.getByTestId('pdf-reader')).toBeVisible();
	await expect(page.locator(`.page[data-page="${at ?? 1}"] .textLayer span`).first()).toBeAttached({ timeout: 15_000 });
}

const frame = (page: Page) => page.frameLocator('[data-testid=book-frame]');

/** Book notes in the vault's Books folder that belong to `id`. */
function notesFor(id: string): string[] {
	const dir = join(VAULT, 'Books');
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((f) => f.endsWith('.md') && new RegExp(`^book: ${id}$`, 'm').test(readFileSync(join(dir, f), 'utf8')));
}

test.beforeAll(async ({ request }) => {
	// The shelf outlives a run (only the vault is rebuilt), so take our books off it first.
	for (const id of [PDF_ID, EPUB_ID]) rmSync(join(SHELF, id), { recursive: true, force: true });
	await resetVault(request);
});

// ---- 1. Add a PDF ---------------------------------------------------------------------------

test('uploading a PDF through the Books tab adds a card, indexes its text and writes its note', async ({ page, request }) => {
	await openBooks(page);
	await page.getByTestId('file-input').setInputFiles(pdfFile);
	await expect(page.getByTestId('book-status')).toHaveText(`Added ${PDF_TITLE}.`);

	const book = card(page, PDF_TITLE);
	await expect(book).toHaveCount(1);
	await expect(book).toContainText('PDF');
	await expect(book.getByRole('link')).toHaveAttribute('href', `/books/${PDF_ID}`);

	// The text is pulled out in the background; the card says so until it is done, then says nothing.
	await waitIndexed(request, PDF_ID);
	await page.reload({ waitUntil: 'networkidle' });
	await expect(card(page, PDF_TITLE).getByTestId('text-state')).toHaveCount(0);

	const note = vaultFile(PDF_NOTE);
	expect(note).toMatch(new RegExp(`^book: ${PDF_ID}$`, 'm'));
	expect(note).toMatch(/^format: pdf$/m);
	expect(note).toMatch(new RegExp(`^source: "?${PDF_NAME}"?$`, 'm'));
	expect(note).toMatch(new RegExp(`^added: "?${TODAY}"?$`, 'm'));
	// A book not yet read has no place, and no highlights heading.
	expect(note).not.toMatch(/^at:/m);
	expect(note).not.toContain('## Highlights');
	// The PDF itself is on the shelf, not in the vault.
	expect(existsSync(join(SHELF, PDF_ID))).toBe(true);
	expect(existsSync(join(VAULT, 'Books', PDF_NAME))).toBe(false);
});

// ---- 2. Place -------------------------------------------------------------------------------

test('a page chosen from Contents is saved as the place, and reopening the book opens on it', async ({ page }) => {
	await openPdf(page);
	await expect(label(page)).toHaveText('p. 1 of 30');
	// Opening a book is not a move: nothing was written.
	expect(vaultFile(PDF_NOTE)).not.toMatch(/^at:/m);

	await page.getByTestId('open-contents').click();
	await page.getByTestId('contents').getByRole('button', { name: 'Chapter Three: Wicks' }).click();
	await expect(label(page)).toHaveText('p. 14 of 30');

	// Saved a few seconds after the last move, with today's date.
	await noteMatches(PDF_NOTE, /^at: p\. 14$/m);
	expect(vaultFile(PDF_NOTE)).toMatch(new RegExp(`^read_at: "?${TODAY}"?$`, 'm'));

	await page.goto(`/books/${PDF_ID}`);
	await expect(label(page)).toHaveText('p. 14 of 30');
	const target = page.locator('.page[data-page="14"]');
	await expect(target.locator('.textLayer span').first()).toBeAttached({ timeout: 15_000 });
	// Page 14 sits at the top of the window, not just named in the label.
	const top = await target.evaluate((el) => el.getBoundingClientRect().top - el.closest('[data-testid=pdf-scroller]')!.getBoundingClientRect().top);
	expect(Math.abs(top)).toBeLessThan(24);
	// Looking is not moving: still nothing new written.
	expect(vaultFile(PDF_NOTE)).toMatch(/^at: p\. 14$/m);
});

// ---- 3. Search ------------------------------------------------------------------------------

test('searching inside the book jumps to the hit with the term marked, and global search lists the book', async ({ page, request }) => {
	await openPdf(page, 14);
	await page.getByTestId('open-search').click();
	await page.getByTestId('book-search').fill(RARE_WORD);
	const hits = page.getByTestId('hits').getByRole('button');
	await expect(hits).toHaveCount(1);
	await expect(hits.first()).toContainText('p. 22');
	await hits.first().click();

	await expect(label(page)).toHaveText('p. 22 of 30');
	await expect.poll(() => page.locator('.page[data-page="22"] .mark.find').count(), { timeout: 15_000, message: 'the search term to be marked on page 22' }).toBeGreaterThan(0);
	// The hit is on screen: the marked box is inside the scroller's window.
	const inView = await page.locator('.page[data-page="22"] .mark.find').first().evaluate((el) => {
		const r = el.getBoundingClientRect();
		const s = document.querySelector('[data-testid=pdf-scroller]')!.getBoundingClientRect();
		return r.top >= s.top && r.bottom <= s.bottom;
	});
	expect(inView).toBe(true);
	// Jumping to a hit is a move, so the place is saved; wait for it so the next test starts from a quiet note.
	await noteMatches(PDF_NOTE, /^at: p\. 22$/m);

	// Global search: the JSON, then the Notes search box.
	const res = await request.get(`/api/search?q=${RARE_WORD}`);
	expect(res.status()).toBe(200);
	const json = await res.json();
	expect(json.books).toHaveLength(1);
	expect(json.books[0]).toMatchObject({ book: PDF_ID, title: PDF_TITLE, place: { kind: 'page', page: 22 }, label: 'p. 22' });
	expect(json.books[0].snippet).toContain('«');

	await page.goto('/notes', { waitUntil: 'networkidle' });
	await page.getByTestId('notes-search').fill(RARE_WORD);
	const group = page.getByTestId('book-search-results');
	await expect(page.getByText('In books', { exact: true })).toBeVisible();
	await expect(group).toContainText(PDF_TITLE);
	await group.getByRole('link').first().click();
	await expect(page).toHaveURL(new RegExp(`/books/${PDF_ID}\\?at=`));
	await expect(label(page)).toHaveText('p. 22 of 30');
	await expect.poll(() => page.locator('.page[data-page="22"] .mark.find').count(), { timeout: 15_000 }).toBeGreaterThan(0);
});

// ---- 4. Highlight ---------------------------------------------------------------------------

test('highlighting text on a PDF page adds one section and one item to the note, and nothing else changes', async ({ page }) => {
	await openPdf(page, 14);
	// Select the sentence on the text layer. Any selection the layer's spans make is a real one to the app.
	const sentence = page.locator('.page[data-page="14"] .textLayer span', { hasText: 'Capillary action' });
	await expect(sentence).toHaveCount(1);
	await sentence.evaluate((el) => {
		const range = document.createRange();
		range.selectNodeContents(el);
		const selection = getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
	});
	await page.getByTestId('highlight-button').click();
	await expect(page.getByTestId('highlight-form')).toContainText(QUOTE);
	await page.getByTestId('highlight-comment').fill('Why   oil rises');

	const before = vaultFile(PDF_NOTE);
	expect(before).not.toContain('## Highlights');
	await page.getByTestId('highlight-save').click();
	await noteMatches(PDF_NOTE, /## Highlights/);

	const expected = `${before.replace(/\s+$/, '')}\n\n## Highlights\n\n- > ${QUOTE} — p. 14\n\t- Why oil rises\n`;
	expect(vaultFile(PDF_NOTE)).toBe(expected);
	// ... and it is drawn on the page.
	await expect.poll(() => page.locator('.page[data-page="14"] .mark.hl').count()).toBeGreaterThan(0);
	await expect(page.getByTestId('highlight-form')).toHaveCount(0);

	// A reload marks it again from the note.
	await page.reload();
	await expect(page.locator('.page[data-page="14"] .textLayer span').first()).toBeAttached({ timeout: 15_000 });
	await expect.poll(() => page.locator('.page[data-page="14"] .mark.hl').count(), { timeout: 15_000 }).toBeGreaterThan(0);
});

// ---- 5. EPUB --------------------------------------------------------------------------------

test('an EPUB opens in the sandboxed HTML reader, steps between chapters and saves its place', async ({ page }) => {
	await openBooks(page);
	await page.getByTestId('file-input').setInputFiles({ name: 'tiny-tales.epub', mimeType: 'application/epub+zip', buffer: epubBytes });
	await expect(page.getByTestId('book-status')).toHaveText(`Added ${EPUB_TITLE}.`);
	const note = `Books/${EPUB_TITLE}.md`;
	expect(vaultFile(note)).toMatch(new RegExp(`^book: ${EPUB_ID}$`, 'm'));
	expect(vaultFile(note)).toMatch(/^format: epub$/m);

	await card(page, EPUB_TITLE).getByRole('link').click();
	await expect(page).toHaveURL(`/books/${EPUB_ID}`);
	const iframe = page.getByTestId('book-frame');
	const sandbox = (await iframe.getAttribute('sandbox')) ?? '';
	expect(sandbox).toContain('allow-scripts');
	expect(sandbox.split(/\s+/)).not.toContain('allow-same-origin');
	await expect(frame(page).locator('h1')).toHaveText('First chapter');
	await expect(page.getByTestId('prev-chapter')).toBeDisabled();
	// Looking is not moving.
	expect(vaultFile(note)).not.toMatch(/^at:/m);

	await page.getByTestId('next-chapter').click();
	await expect(frame(page).locator('h1')).toHaveText('Second chapter');
	await expect(page.getByTestId('next-chapter')).toBeDisabled();
	await noteMatches(note, /^at: OEBPS\/text\/ch2\.xhtml(#[\w-]+)?$/m);

	// Reopening finds the chapter it was left on.
	await page.goto(`/books/${EPUB_ID}`);
	await expect(frame(page).locator('h1')).toHaveText('Second chapter');

	await page.getByTestId('prev-chapter').click();
	await expect(frame(page).locator('h1')).toHaveText('First chapter');
	await noteMatches(note, /^at: OEBPS\/text\/ch1\.xhtml(#[\w-]+)?$/m);
	expect(vaultFile(note)).toMatch(new RegExp(`^read_at: "?${TODAY}"?$`, 'm'));
});

// ---- 6. A saved site ------------------------------------------------------------------------

const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.png': 'image/png',
	'.woff2': 'font/woff2'
};

/** Serve the invented mdBook site under a prefix no earlier run used, so its book id is new. */
function serveSite(prefix: string): Promise<Server> {
	const server = createServer((req, res) => {
		const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
		if (!path.startsWith(prefix)) return void res.writeHead(404).end();
		const rel = normalize(path.slice(prefix.length) || '/');
		const file = join(SITE_DIR, rel.endsWith('/') ? `${rel}index.html` : rel);
		if (!file.startsWith(SITE_DIR) || !existsSync(file) || !readdirSync(dirname(file)).includes(file.slice(dirname(file).length + 1))) return void res.writeHead(404).end();
		res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('a pasted URL is saved as a site book whose quiz remembers its answer through the server', async ({ page, request }) => {
	const prefix = `/lantern-${Date.now()}/`;
	const server = await serveSite(prefix);
	try {
		const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${prefix}`;
		await openBooks(page);
		await page.getByTestId('book-url').fill(url);
		await page.getByTestId('save-url').click();
		await expect(page.getByTestId('book-status')).toHaveText(/^Added .+\.$/, { timeout: 25_000 });

		const books = (await (await request.get('/api/books')).json()).books as { id: string; format: string; source: string }[];
		const site = books.find((b) => b.format === 'site' && b.source.includes(prefix));
		expect(site, 'the saved site is listed').toBeTruthy();
		const id = site!.id;
		await expect(page.locator(`[data-testid=book] a[href="/books/${id}"]`)).toHaveCount(1);

		const storage = join(SHELF, id, 'storage.json');
		expect(existsSync(storage)).toBe(false);

		// Open the quiz chapter from the contents.
		await page.goto(`/books/${id}`);
		await page.getByTestId('open-contents').click();
		await page.getByTestId('contents').getByRole('button', { name: 'A Quiz' }).click();
		const result = frame(page).locator('.quiz .result');
		await expect(frame(page).locator('.quiz .prompt')).toHaveText('What does a wick do?');
		await expect(result).toHaveText('');
		await frame(page).locator('.quiz .start').click();
		await expect(result).toHaveText('Answered: draws up oil');

		// The frame cannot reach the server; the reader carries its storage up.
		await expect.poll(() => (existsSync(storage) ? (JSON.parse(readFileSync(storage, 'utf8')) as Record<string, string>) : null), { timeout: 10_000, message: 'storage.json to hold the answer' }).toEqual({ 'quiz:ch02-quiz-sec1': 'draws up oil' });

		// A fresh load of the reader, which has no memory of its own, shows the answer.
		await page.goto(`/books/${id}?at=ch02-quiz.html`);
		await expect(frame(page).locator('.quiz .prompt')).toHaveText('What does a wick do?');
		await expect(frame(page).locator('.quiz .result')).toHaveText('Answered: draws up oil');
	} finally {
		await new Promise((r) => server.close(r));
	}
});

// ---- 7. Same file again ---------------------------------------------------------------------

test('uploading the same PDF again reports the existing book and makes no second note', async ({ page }) => {
	const before = vaultFile(PDF_NOTE);
	await openBooks(page);
	await page.getByTestId('file-input').setInputFiles(pdfFile);
	await expect(page.getByTestId('book-status')).toHaveText(`${PDF_TITLE} was already here; its place and highlights are kept.`);
	await expect(card(page, PDF_TITLE)).toHaveCount(1);
	expect(notesFor(PDF_ID)).toEqual([`${PDF_TITLE}.md`]);
	expect(readdirSync(join(VAULT, 'Books')).filter((f) => f.startsWith(PDF_TITLE))).toEqual([`${PDF_TITLE}.md`]);
	// The note is not touched.
	expect(vaultFile(PDF_NOTE)).toBe(before);
});

// ---- 8. Remove ------------------------------------------------------------------------------

test('removing a PDF deletes its files, keeps its note and highlights, and the card asks for the file again', async ({ page }) => {
	const before = vaultFile(PDF_NOTE);
	expect(before).toContain(`- > ${QUOTE}`);
	await openBooks(page);
	await card(page, PDF_TITLE).getByTestId('remove-book').click();
	await page.getByRole('button', { name: 'Remove files' }).click();

	const gone = card(page, PDF_TITLE);
	await expect(gone.getByTestId('upload-again')).toContainText('Upload the file again');
	await expect(gone.getByTestId('upload-again')).toContainText(PDF_NAME);
	await expect(gone.getByTestId('remove-book')).toHaveCount(0);
	await expect(page.getByTestId('book-status')).toContainText('Its note, place and highlights are kept');
	expect(existsSync(join(SHELF, PDF_ID))).toBe(false);
	expect(vaultFile(PDF_NOTE)).toBe(before);

	// Opening it says the file is missing instead of failing.
	await page.goto(`/books/${PDF_ID}`);
	await expect(page.getByTestId('book-missing')).toContainText("isn't on the server");
});

test('adding the removed PDF again finds its note: the place and the highlight are back', async ({ page }) => {
	const before = vaultFile(PDF_NOTE);
	await openBooks(page);
	await page.getByTestId('file-input').setInputFiles(pdfFile);
	await expect(page.getByTestId('book-status')).toHaveText(`${PDF_TITLE} was already here; its place and highlights are kept.`);
	await expect(card(page, PDF_TITLE).getByTestId('upload-again')).toHaveCount(0);
	await expect(card(page, PDF_TITLE)).toContainText('p. 22 of 30');
	expect(notesFor(PDF_ID)).toHaveLength(1);
	expect(vaultFile(PDF_NOTE)).toBe(before);
});

// ---- 9. Phone -------------------------------------------------------------------------------

test.describe('on a phone', () => {
	test.use({ viewport: { width: 412, height: 915 } });

	/** True when the page can be scrolled sideways. */
	const overflows = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth || document.body.scrollWidth > document.documentElement.clientWidth);

	test('the Books tab fits the screen', async ({ page }) => {
		await openBooks(page);
		await expect(card(page, PDF_TITLE)).toBeVisible();
		await expect(card(page, EPUB_TITLE)).toBeVisible();
		expect(await overflows(page)).toBe(false);
		// Everything on the tab is within the screen, not just the document's own width.
		const wide = await page.evaluate(() => [...document.querySelectorAll('.page *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed').length);
		expect(wide).toBe(0);
	});

	test('the PDF reader fits the screen and collapses its toolbar into one menu', async ({ page }) => {
		await openPdf(page, 14);
		await expect(label(page)).toHaveText('p. 14 of 30');
		expect(await overflows(page)).toBe(false);
		const scroller = page.getByTestId('pdf-scroller');
		// Fit to width: the page is not wider than the window, so nothing scrolls sideways.
		expect(await scroller.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
		const box = await page.locator('.page[data-page="14"]').boundingBox();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(412);

		// The toolbar's buttons are gone; one menu button stands for them.
		await expect(page.locator('.tools')).toBeHidden();
		await expect(page.getByTestId('reader-menu')).toBeVisible();
		await expect(page.getByTestId('open-contents')).toHaveCount(1);
		await expect(page.getByTestId('open-contents')).toBeHidden();
		await page.getByTestId('reader-menu').click();
		await expect(page.getByTestId('open-search').filter({ visible: true })).toBeVisible();
		await page.getByTestId('open-contents').filter({ visible: true }).click();
		// A phone's panel covers the book; choosing an entry closes it and goes there.
		await page.getByTestId('contents').getByRole('button', { name: 'Chapter Two: Oil' }).click();
		await expect(label(page)).toHaveText('p. 8 of 30');
		await expect(page.getByTestId('contents')).toHaveCount(0);
		expect(await overflows(page)).toBe(false);
	});
});
