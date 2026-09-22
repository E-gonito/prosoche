import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import { createRawSnippet } from 'svelte';
import EmptyState from './EmptyState.svelte';

/**
 * EmptyState is one shape reused across pages and widgets, so the risk worth
 * testing is not the icon (icon.test.ts already covers that) but that every
 * prop actually reaches the markup: a hint silently dropped, or a testid that
 * lands on the wrong element, would be invisible in a screenshot and would
 * fail every e2e test that depends on it in a confusing way.
 */
const snippet = (html: string) => createRawSnippet(() => ({ render: () => html }));

describe('EmptyState', () => {
	it('renders the title and icon, with no hint or action by default', () => {
		const { body } = render(EmptyState, { props: { icon: 'search', title: 'Nothing matched.' } });
		expect(body).toContain('Nothing matched.');
		expect(body).toContain('<path');
		expect(body).not.toContain('class="hint"');
		expect(body).not.toContain('class="action"');
	});

	it('renders an optional hint', () => {
		const { body } = render(EmptyState, {
			props: { icon: 'search', title: 'Nothing matched.', hint: 'Try a different word.' }
		});
		expect(body).toContain('Try a different word.');
	});

	it('renders the action snippet inside its own wrapper', () => {
		const { body } = render(EmptyState, {
			props: {
				icon: 'sparkles',
				title: 'AI is switched off.',
				action: snippet('<a href="/settings/ai">Turn it back on</a>')
			}
		});
		expect(body).toMatch(/class="action[^"]*"/);
		expect(body).toContain('Turn it back on');
	});

	it('puts the given testid on its own root, not a wrapper', () => {
		const { body } = render(EmptyState, {
			props: { icon: 'search', title: 'Nothing matched.', testid: 'search-empty' }
		});
		expect(body).toContain('data-testid="search-empty"');
		expect(body.indexOf('data-testid="search-empty"')).toBeLessThan(body.indexOf('Nothing matched.'));
	});
});
