import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// better-sqlite3 is a native module; bundling it breaks the build.
	ssr: { external: ['better-sqlite3'] },
	server: { host: '0.0.0.0', port: 5173 }
});
