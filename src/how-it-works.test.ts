import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `docs/how-it-works.md` is where the explanations trimmed from the screens
 * went, so a page it describes and `src/routes` does not serve is worse than
 * no page at all: it reads as true and sends the reader to a dead screen.
 *
 * This is the one direction worth checking. A route the page leaves out is a
 * gap in the documentation; a page the guide promises and the app lacks is a
 * broken promise. Only the `##` headings are read, one per screen, and each
 * is mapped to the route directory that serves it. "Widgets" is skipped
 * because it describes cards that appear on several screens, not a screen.
 *
 * Renaming a screen fails this test on purpose: update the heading and the
 * mapping together, so the guide keeps calling the screen what the app does.
 */
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const doc = readFileSync(here('../docs/how-it-works.md'), 'utf8');
const routes = new Set(
	readdirSync(here('./routes'), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
);

/** Headings whose route directory is not simply the heading in lower case. */
const ROUTE_FOR: Record<string, string> = {
	Today: 'day',
	'AI settings': 'settings',
	'Workspaces and boards': 'w'
};

const NOT_A_SCREEN = new Set(['Widgets']);

const screens = [...doc.matchAll(/^## (.+)$/gm)]
	.map(([, heading]) => heading)
	.filter((heading) => !NOT_A_SCREEN.has(heading));

describe('docs/how-it-works.md', () => {
	it.each(screens)('"%s" is served by a route', (heading) => {
		const route = ROUTE_FOR[heading] ?? heading.toLowerCase();
		expect(routes, `no src/routes/${route} for heading "${heading}"`).toContain(route);
	});
});
