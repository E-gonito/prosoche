import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import Icon, { ICON_NAMES, type IconName } from './Icon.svelte';
import { NAV, SETTINGS, TABS } from '$lib/client/nav';

/**
 * The pairing this file exists to hold is nav item to icon.
 *
 * TypeScript already refuses an icon name that does not exist, so the risk is
 * the other direction: a name that compiles because the type says so, but that
 * `PATHS` has no shapes for. That renders an empty `svg` — a hole in the
 * sidebar with nothing in the console. Rendering each one and counting the
 * paths is the only thing that catches it.
 */
const drawn = (name: IconName, props: { label?: string } = {}) =>
	render(Icon, { props: { name, ...props } }).body;

describe('the icon set', () => {
	it('draws at least one shape for every name it claims', () => {
		for (const name of ICON_NAMES) {
			expect(drawn(name), name).toContain('<path');
		}
	});

	it('is decorative unless it is given a label', () => {
		const svg = drawn('search');
		expect(svg).toContain('aria-hidden="true"');
		expect(svg).not.toContain('role="img"');
	});

	it('announces itself when it is the only thing saying what a control does', () => {
		const svg = drawn('check', { label: 'Mark finished' });
		expect(svg).toContain('role="img"');
		expect(svg).toContain('aria-label="Mark finished"');
		expect(svg).not.toContain('aria-hidden');
	});

	it('draws on the one grid, so a row of them lines up', () => {
		for (const name of ICON_NAMES) {
			expect(drawn(name), name).toContain('viewBox="0 0 24 24"');
		}
	});
});

describe('the navigation', () => {
	it('gives every destination an icon that exists', () => {
		for (const item of [...NAV, SETTINGS, ...TABS]) {
			expect(ICON_NAMES, item.label).toContain(item.icon);
		}
	});

	it('puts four destinations and a way to everything else on the phone bar', () => {
		expect(TABS).toHaveLength(5);
		expect(TABS.filter((t) => t.href === null)).toHaveLength(1);
		expect(TABS.map((t) => t.label)).toEqual(['Today', 'Study', 'Notes', 'Search', 'More']);
	});

	it('only offers the phone destinations the sidebar also has', () => {
		const sidebar = NAV.map((item) => item.href);
		for (const tab of TABS) {
			if (tab.href !== null) expect(sidebar).toContain(tab.href);
		}
	});
});
