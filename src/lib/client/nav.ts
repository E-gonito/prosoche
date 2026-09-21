/**
 * Where the app can be navigated to, written once.
 *
 * The sidebar and the phone's bottom tab bar are two drawings of the same
 * small list, so the list lives here rather than in the layout that happens to
 * draw both. Keeping it out of the component also lets a test assert that
 * every destination names an icon that exists, which is the only way that
 * pairing is checked at all — an unknown name is a compile error in `Icon`,
 * but a nav item is data and would otherwise fail silently in the browser.
 *
 * Workspaces are not here. They come out of the vault, so the layout reads
 * them from its load function and draws them below this list.
 */

import type { IconName } from '$lib/components/Icon.svelte';

export interface NavItem {
	href: string;
	label: string;
	icon: IconName;
}

/** The sidebar's own destinations, in the order they appear. */
export const NAV: NavItem[] = [
	{ href: '/', label: 'Today', icon: 'calendar' },
	{ href: '/notes', label: 'Notes', icon: 'file-text' },
	{ href: '/study', label: 'Study', icon: 'graduation-cap' },
	{ href: '/ask', label: 'Ask', icon: 'sparkles' },
	{ href: '/search', label: 'Search', icon: 'search' },
	{ href: '/review', label: 'Review', icon: 'check-square' },
	{ href: '/sync', label: 'Sync', icon: 'arrow-up-down' }
];

/** Pinned to the bottom of the sidebar, away from the day-to-day list. */
export const SETTINGS: NavItem = { href: '/settings/ai', label: 'Settings', icon: 'settings' };

/**
 * The phone's bottom bar: four destinations and a way to everything else.
 *
 * Five is the most a thumb can hit reliably across a phone's width, so the
 * fifth is "More", which has no `href` because it opens the command palette —
 * the palette already lists the workspaces and every command, so the bar does
 * not need to grow when the vault does.
 */
export const TABS: Array<NavItem | { href: null; label: string; icon: IconName }> = [
	NAV[0],
	NAV[2],
	NAV[1],
	NAV[4],
	{ href: null, label: 'More', icon: 'more-horizontal' }
];
