import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';

/**
 * The data files pdf.js fetches at run time, by URL, for some PDFs: CMaps for
 * CJK and other non-Latin text, the 14 standard fonts for a PDF that names
 * one without embedding it, colour profiles, and the WASM image decoders for
 * JPEG 2000. They are not modules, so Vite would not ship them. This serves
 * them at `/pdfjs/<folder>/<file>` in dev and copies them into the client
 * build, so the reader can point pdf.js at `/pdfjs/`.
 */
function pdfjsData(): Plugin {
	const root = join(import.meta.dirname, 'node_modules/pdfjs-dist');
	const folders = ['cmaps', 'standard_fonts', 'iccs', 'wasm'];
	return {
		name: 'pdfjs-data',
		configureServer(server) {
			server.middlewares.use('/pdfjs', (req, res, next) => {
				const [folder, file, ...rest] = (req.url ?? '').split('?')[0].replace(/^\/+/, '').split('/');
				if (!folders.includes(folder) || !file || rest.length || file.startsWith('.')) return next();
				try {
					res.end(readFileSync(join(root, folder, decodeURIComponent(file))));
				} catch {
					next();
				}
			});
		},
		generateBundle() {
			if (this.environment?.name !== 'client') return;
			for (const folder of folders) {
				for (const file of readdirSync(join(root, folder))) {
					this.emitFile({ type: 'asset', fileName: `pdfjs/${folder}/${file}`, source: readFileSync(join(root, folder, file)) });
				}
			}
		}
	};
}

export default defineConfig({
	plugins: [sveltekit(), pdfjsData()],
	// better-sqlite3 is a native module; bundling it breaks the build.
	ssr: { external: ['better-sqlite3'] },
	server: { host: '0.0.0.0', port: 5173 }
});
