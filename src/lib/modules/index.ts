/**
 * The modules: every tab in the app, written once.
 *
 * A module is a folder of routes under `src/routes/<id>/` plus one entry
 * here. The rail, the phone's tab bar and the palette all draw from this
 * list, so adding a tab is one route folder and one line. The alternative, a
 * plugin loader reading modules from the vault at runtime, was rejected in
 * `docs/plan-rebuild.md`: SvelteKit's file routing already gives each module
 * its pages, loaders and types.
 *
 * This file is imported by the browser, so it holds only what the navigation
 * needs. What a module contributes to Today lives in `today.server.ts`.
 */

import type { IconName } from '$lib/components/Icon.svelte';

interface Module {
	/** Also the first segment of every route the module serves. */
	id: string;
	title: string;
	icon: IconName;
	href: string;
	/**
	 * A private module reads the vault's private folder and nothing it holds
	 * appears anywhere else: not on Today, not in search, not in the palette's
	 * note list. Only Date is private.
	 */
	private?: boolean;
	/** One of the destinations on a phone's tab bar, ahead of More. */
	tab?: boolean;
}

/**
 * An entry the rail nests under a module: one workspace under Workspaces,
 * one glossary under Glossary, one subject under Study. They
 * come from the vault, so the root layout's loader supplies them, keyed by
 * module id; this file only says what one looks like and which one a path
 * is on.
 */
export interface SubItem {
	href: string;
	title: string;
	/** A dot before the title: the workspace's colour, or a glossary's linked workspace's. */
	color: string;
}

/** In the order the rail draws them. */
export const MODULES: Module[] = [
	{ id: 'today', title: 'Today', icon: 'sun', href: '/today', tab: true },
	{ id: 'glossary', title: 'Glossary', icon: 'book-a', href: '/glossary' },
	{ id: 'w', title: 'Workspaces', icon: 'briefcase', href: '/w', tab: true },
	{ id: 'study', title: 'Study', icon: 'graduation-cap', href: '/study' },
	{ id: 'date', title: 'Date', icon: 'calendar', href: '/date', private: true },
	{ id: 'notes', title: 'Notes', icon: 'book-open', href: '/notes', tab: true }
];

/** The system pages, pinned to the foot of the rail, away from the modules. */
export const SYSTEM: Module[] = [
	// Not a module of its own: the one inbox, reached from Today's Inbox card,
	// the palette's `i` and, later, the evening review.
	{ id: 'inbox', title: 'Inbox', icon: 'inbox', href: '/inbox' },
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

/**
 * The sub-item a path is on: the one whose href the path is, or is under.
 * Null when it is on none, such as a module's own index page. Pure.
 */
export function subItemFor(items: SubItem[], pathname: string): SubItem | null {
	return items.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) ?? null;
}
