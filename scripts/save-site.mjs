#!/usr/bin/env node
/**
 * Dev tool, not part of the app: save a site as a book into a shelf folder
 * with the same module the server uses, and print what happened.
 *
 *   node scripts/save-site.mjs <url> [shelf-dir]
 *
 * `shelf-dir` defaults to a new temp folder. The book's id is `siteId(url)`,
 * so the folder `<shelf-dir>/<id>/html/` is what the reader would serve.
 * Set HUB_BOOKS_ALLOW_LOCAL=1 to save a site on this machine.
 *
 * The module is TypeScript with `$lib` imports, so it is loaded through
 * vite's SSR loader with the same aliases the unit tests use.
 */
import { createServer } from 'vite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [url, shelfArg] = process.argv.slice(2);
if (!url) {
	console.error('usage: node scripts/save-site.mjs <url> [shelf-dir]');
	process.exit(2);
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({
	root: repo,
	configFile: false,
	logLevel: 'error',
	server: { middlewareMode: true, hmr: false, watch: null },
	appType: 'custom',
	resolve: { alias: { $lib: join(repo, 'src/lib'), $server: join(repo, 'src/lib/server') } },
	optimizeDeps: { noDiscovery: true }
});
try {
	const { Shelf } = await vite.ssrLoadModule('/src/lib/server/vault/shelf.ts');
	const { saveSite } = await vite.ssrLoadModule('/src/lib/server/books/site.ts');
	const { siteId } = await vite.ssrLoadModule('/src/lib/server/books/id.ts');

	const dir = shelfArg ? resolve(shelfArg) : await mkdtemp(join(tmpdir(), 'save-site-'));
	const id = siteId(url);
	if (!id) throw new Error(`not a site address: ${url}`);
	const shelf = new Shelf(dir);
	const started = Date.now();
	let last = 0;
	const result = await saveSite(shelf, id, url, {
		onProgress: (done, total) => {
			if (Date.now() - last > 500 || done === total) {
				last = Date.now();
				process.stderr.write(`\r  ${done}/${total} files   `);
			}
		}
	});
	process.stderr.write('\n');
	const seconds = ((Date.now() - started) / 1000).toFixed(1);
	if (!result.ok) {
		console.error(`REFUSED (${result.reason}): ${result.message}  [${seconds}s]`);
		process.exitCode = 1;
	} else {
		const files = await shelf.files(id);
		const assets = files.filter((f) => f.startsWith('html/')).length - result.chapters.length;
		console.log(`shelf      ${dir}`);
		console.log(`book id    ${id}`);
		console.log(`title      ${result.title}`);
		console.log(`chapters   ${result.chapters.length} (contents lines: ${result.contents.length})`);
		console.log(`assets     ${assets}`);
		console.log(`files      ${result.files}`);
		console.log(`bytes      ${result.bytes} (${(result.bytes / 1024 / 1024).toFixed(1)} MB)`);
		console.log(`time       ${seconds}s`);
		console.log(`warnings   ${result.warnings.length}`);
		for (const w of result.warnings ?? []) console.log(`  - ${w}`);
	}
} finally {
	await vite.close();
}
