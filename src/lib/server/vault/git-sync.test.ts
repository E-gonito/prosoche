import { describe, it, expect } from 'vitest';
import { commitSubject, isTransient } from './git-sync';

describe('commitSubject', () => {
	it('names a single file', () => {
		expect(commitSubject(['Journal/2026/09/21.md'])).toBe('hub: 1 file (21.md)');
	});

	it('lists up to three and counts the rest', () => {
		expect(commitSubject(['a/1.md', 'b/2.md', 'c/3.md', 'd/4.md', 'e/5.md'])).toBe(
			'hub: 5 files (1.md, 2.md, 3.md, +2 more)'
		);
	});

	it('is distinguishable from a hand-written commit', () => {
		expect(commitSubject(['x.md']).startsWith('hub: ')).toBe(true);
	});
});

describe('transient state', () => {
	it('is written to the vault but never committed', () => {
		// A running timer has to survive a restart, so it is a file; but a
		// commit per start and stop would bury the user's real history.
		expect(isTransient('_hub/timer.json')).toBe(true);
		expect(isTransient('_hub/.state/anything.json')).toBe(true);
		expect(isTransient('_hub/workspaces/work.md')).toBe(false);
		expect(isTransient('Journal/2026/09/21.md')).toBe(false);
	});
});
