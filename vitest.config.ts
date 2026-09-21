import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

/**
 * The unit suite runs the modules directly, without SvelteKit, so the aliases
 * SvelteKit provides have to be repeated here. Without them a server module
 * could import `$lib/shared/...` as a type but not as a value, which pushed
 * several modules into relative paths for no reason a reader could see.
 *
 * The Svelte plugin is here for the `.svelte.ts` modules — the timer, the
 * palette, the shortcut registry — which are ordinary modules that happen to
 * use runes. Without it they cannot be imported at all, so the client logic
 * with the most state in it was the least tested, which is backwards. `$state`
 * outside a component still works: it is a plain value that notifies, and the
 * suite only needs it to hold what was put in it.
 */
const alias = {
	$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
	$server: fileURLToPath(new URL('./src/lib/server', import.meta.url))
};

export default defineConfig({
	plugins: [svelte({ compilerOptions: { runes: true } })],
	resolve: { alias },
	test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
