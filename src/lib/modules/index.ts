/**
 * The modules: every tab in the app, written once.
 *
 * A module is a folder of routes under `src/routes/<id>/` plus one entry
 * here. The rail, the phone's bottom bar and the palette all draw from this
 * list, so adding a tab is one route folder and one line. The alternative, a
 * plugin loader reading modules from the vault at runtime, was rejected in
 * `docs/plan-rebuild.md`: SvelteKit's file routing already gives each module
 * its pages, loaders and types.
 *
 * This file is imported by the browser, so it holds only what the navigation
 * needs. What a module contributes to Today lives in `today.server.ts`.
 */

import type { IconName } from '$lib/components/Icon.svelte';

export interface Module {
	/** Also the first segment of every route the module serves. */
	id: string;
	title: string;
	icon: IconName;
	href: string;
	/**
	 * A private module reads the vault's private folder and nothing it holds
	 * appears anywhere else: not on Today, not in search, not in the palette's
	 * note list. Only Dating is private.
	 */
	private?: boolean;
	/** One of the four destinations on a phone's bottom bar. */
	tab?: boolean;
}

/** In the order the rail draws them. */
export const MODULES: Module[] = [
	{ id: 'today', title: 'Today', icon: 'sun', href: '/today', tab: true },
	{ id: 'meetings', title: 'Meetings', icon: 'users', href: '/meetings', tab: true },
	{ id: 'w', title: 'Workspaces', icon: 'briefcase', href: '/w', tab: true },
	{ id: 'study', title: 'Study', icon: 'graduation-cap', href: '/study' },
	{ id: 'dating', title: 'Dating', icon: 'heart', href: '/dating', private: true },
	{ id: 'notes', title: 'Notes', icon: 'book-open', href: '/notes', tab: true }
];

/** The system pages, pinned to the foot of the rail, away from the modules. */
export const SYSTEM: Module[] = [
	{ id: 'sync', title: 'Sync', icon: 'arrow-up-down', href: '/sync' },
	{ id: 'settings', title: 'Settings', icon: 'settings', href: '/settings' }
];

/**
 * The module a path belongs to, for highlighting it in the navigation. The
 * root redirects to Today, so it counts as Today.
 */
export function moduleFor(pathname: string): Module | null {
	if (pathname === '/') return MODULES[0];
	const first = pathname.split('/')[1] ?? '';
	return [...MODULES, ...SYSTEM].find((m) => m.id === first) ?? null;
}
