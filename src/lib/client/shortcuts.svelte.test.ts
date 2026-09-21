import { describe, it, expect, afterEach } from 'vitest';
import { all, keyLabel, register, type Shortcut } from './shortcuts.svelte';

const shortcut = (keys: string, description = keys): Shortcut => ({
	keys,
	description,
	group: 'Test',
	run: () => {}
});

const cleanups: Array<() => void> = [];
const add = (...s: Shortcut[]) => {
	const off = register(s);
	cleanups.push(off);
	return off;
};

afterEach(() => {
	while (cleanups.length) cleanups.pop()!();
});

describe('the shortcut registry', () => {
	it('lists what was registered', () => {
		add(shortcut('t', 'Today'), shortcut('s', 'Search'));
		expect(all().map((s) => s.description)).toEqual(['Today', 'Search']);
	});

	it('removes exactly what one registration added', () => {
		add(shortcut('t', 'Today'));
		const off = register([shortcut('s', 'Search')]);
		expect(all()).toHaveLength(2);

		off();
		expect(all().map((s) => s.description)).toEqual(['Today']);
	});

	/**
	 * The bug this file exists to prevent. When the registry was a `$state`
	 * array it stored proxies, so `indexOf` never matched the raw object the
	 * caller held and unregister silently did nothing. Every navigation then
	 * left its bindings behind, and the list grew without bound.
	 */
	it('does not leak a registration when it is undone', () => {
		for (let i = 0; i < 50; i++) register([shortcut('t', 'Today')])();
		expect(all()).toEqual([]);
	});

	it('gives a caller a new list each time, so the last one cannot go stale', () => {
		const before = all();
		add(shortcut('t'));
		expect(all()).not.toBe(before);
		expect(before).toHaveLength(0);
	});

	it('lower-cases the keys it stores, so a binding is spelt one way', () => {
		add({ ...shortcut('Mod+K'), description: 'Palette' });
		expect(all()[0].keys).toBe('mod+k');
	});

	it('keeps a binding with no keys, which is a palette-only command', () => {
		add(shortcut('', 'Review waiting changes'));
		expect(all()[0].keys).toBe('');
	});
});

describe('keyLabel', () => {
	it('is empty for a command with no binding, so a caller needs no branch', () => {
		expect(keyLabel('')).toBe('');
		expect(keyLabel('   ')).toBe('');
	});

	it('spells out a chord', () => {
		expect(keyLabel('mod+k')).toMatch(/K$/);
	});
});
