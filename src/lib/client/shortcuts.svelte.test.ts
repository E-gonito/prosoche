import { describe, it, expect, afterEach, vi } from 'vitest';
import { all, install, keyLabel, press, type Shortcut } from './shortcuts.svelte';

const shortcut = (keys: string, description = keys, run = () => {}): Shortcut => ({ keys, description, run });

let stop = () => {};
const use = (...s: Shortcut[]) => {
	stop = install(s);
};
afterEach(() => stop());

describe('the shortcut list', () => {
	it('lists what was installed, in order', () => {
		use(shortcut('t', 'Today'), shortcut('s', 'Search'));
		expect(all().map((s) => s.description)).toEqual(['Today', 'Search']);
	});

	it('is empty once stopped', () => {
		use(shortcut('t'));
		stop();
		expect(all()).toEqual([]);
	});

	/** One registrant: a second install is a new list, not an addition to the first. */
	it('replaces the earlier list when installed again', () => {
		use(shortcut('t', 'Today'));
		use(shortcut('s', 'Search'));
		expect(all().map((s) => s.description)).toEqual(['Search']);
	});

	it('lower-cases the keys it stores, so a binding is spelt one way', () => {
		use(shortcut('Mod+K', 'Palette'));
		expect(all()[0].keys).toBe('mod+k');
	});

	it('keeps a binding with no keys, which is a palette-only command', () => {
		use(shortcut('', 'Review waiting changes'));
		expect(all()[0].keys).toBe('');
	});
});

describe('pressing a key', () => {
	it('runs the binding and says so', () => {
		const run = vi.fn();
		use(shortcut('t', 'Today', run));
		expect(press('t', false)).toBe(true);
		expect(run).toHaveBeenCalledOnce();
	});

	it('does nothing for a key nobody bound', () => {
		use(shortcut('t'));
		expect(press('x', false)).toBe(false);
	});

	it('never fires while the user is typing, unless the binding opts in', () => {
		const plain = vi.fn();
		const chord = vi.fn();
		use(shortcut('t', 'Today', plain), { ...shortcut('mod+k', 'Palette', chord), whileTyping: true });
		expect(press('t', true)).toBe(false);
		expect(plain).not.toHaveBeenCalled();
		expect(press('mod+k', true)).toBe(true);
		expect(chord).toHaveBeenCalledOnce();
	});

	it('runs the first of two bindings that share keys', () => {
		const first = vi.fn();
		const second = vi.fn();
		use(shortcut('t', 'A', first), shortcut('t', 'B', second));
		press('t', false);
		expect(first).toHaveBeenCalledOnce();
		expect(second).not.toHaveBeenCalled();
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
