import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export const VAULT = '/tmp/prosoche-e2e/vault';

/**
 * The timeline's scale, mirrored from `Timeline.svelte`.
 *
 * A drag test cares about minutes, not pixels. Spelling the conversion out
 * here means changing the scale breaks one constant instead of silently
 * turning "drag it an hour later" into half an hour, which is exactly what
 * happened when it went from one pixel a minute to two.
 */
export const PX_PER_MIN = 2;

/** That many minutes of timeline, in pixels. */
export const minutes = (n: number): number => n * PX_PER_MIN;

const now = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
export const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
export const TODAY_NOTE = `Journal/${TODAY.slice(0, 4)}/${TODAY.slice(5, 7)}/${TODAY.slice(8, 10)}.md`;

/** Read a file out of the fixture vault, to check what the app actually wrote. */
export function vaultFile(path: string): string {
	const full = join(VAULT, path);
	return existsSync(full) ? readFileSync(full, 'utf8') : '';
}

/** One line of a vault file, 0-indexed, as the app numbers them. */
export function vaultLine(path: string, line: number): string {
	return vaultFile(path).split('\n')[line] ?? '';
}

/** The line containing a fragment, so tests do not hardcode line numbers. */
export function lineWith(path: string, fragment: string): { index: number; text: string } {
	const lines = vaultFile(path).split('\n');
	const index = lines.findIndex((l) => l.includes(fragment));
	return { index, text: lines[index] ?? '' };
}

/** Drag from one point to another with real pointer events. */
export async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	// Several small steps, so threshold and move handlers both fire.
	for (let i = 1; i <= 8; i++) {
		await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
		await page.waitForTimeout(12);
	}
	await page.mouse.up();
}

/** Centre of an element, for pointer gestures. */
export async function centre(page: Page, selector: string, nth = 0) {
	const box = await page.locator(selector).nth(nth).boundingBox();
	if (!box) throw new Error(`No box for ${selector}`);
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Wait until the app has written the change to disk. */
export async function waitForFile(path: string, predicate: (content: string) => boolean, timeoutMs = 5000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (predicate(vaultFile(path))) return true;
		await new Promise((r) => setTimeout(r, 100));
	}
	return false;
}

/**
 * Restore the fixture vault to its committed baseline and rebuild the index.
 *
 * The suite drives one server against one vault, so without this a test would
 * inherit whatever the previous one wrote. The rebuild is synchronous on the
 * server, which makes the reset deterministic rather than a race with the file
 * watcher.
 */
export async function resetVault(request: { post: (url: string, opts?: unknown) => Promise<unknown> }) {
	const git = (...args: string[]) => execFileSync('git', ['-C', VAULT, ...args], { stdio: 'pipe' });
	// Rewind history as well as the working tree: the sync tests commit, so
	// restoring to HEAD would leave the next test with a moved baseline. The
	// remote is force-reset too, or a pull would bring the commit straight back.
	git('reset', '--hard', '-q', 'fixture-baseline');
	git('clean', '-qfd');
	git('push', '-q', '--force', 'origin', 'master');
	await request.post('/api/sync', { data: { action: 'rebuild' } });
}
