import { describe, expect, it } from 'vitest';
import { blockFor, blockMinutes, nextBlock, loggedSessions, outcomeLine, withBullet, DEFAULT_MINUTES } from './block';

const NOTE = [
	'# Tasks',
	'- [x] 09:00 - 09:30 Study Rust `Q2`',
	'- [ ] 17:00 - 17:30 Study Fullstack `Q2`',
	'\t- an existing note',
	'- [ ] Study Systems',
	'- [ ] 21:00 - 22:00 leyline-frontline',
	'- [ ] Trust the process',
	'## Backlog',
	'```',
	'- [ ] Study Fullstack later',
	'```'
].join('\n');

describe('blockFor', () => {
	it('finds the first open task that mentions the name', () => {
		expect(blockFor(NOTE, ['Fullstack'])).toMatchObject({ line: 2, startMin: 1020, endMin: 1050 });
	});

	it('matches an alias, ignoring case', () => {
		expect(blockFor(NOTE, ['Rust', 'leyline-front', 'Leyline-Frontline'])?.line).toBe(5);
	});

	it('skips a ticked task, so a finished block is not offered again', () => {
		expect(blockFor(NOTE, ['Rust'])).toBeNull();
	});

	it('matches whole words only', () => {
		expect(blockFor(NOTE, ['Rust'])).toBeNull();
		expect(blockFor('- [ ] Trust the process', ['Rust'])).toBeNull();
	});

	it('ignores the fenced backlog', () => {
		expect(blockFor('```\n- [ ] Study Fullstack\n```', ['Fullstack'])).toBeNull();
	});

	it('a line with no times has none', () => {
		expect(blockFor(NOTE, ['Systems'])).toMatchObject({ line: 4, startMin: null });
	});

	it('includes the sub-bullets in the block', () => {
		expect(blockFor(NOTE, ['Fullstack'])!.blockEnd).toBe(3);
	});
});

describe('blockMinutes', () => {
	it('is the range, or the default without one', () => {
		expect(blockMinutes(blockFor(NOTE, ['Fullstack']))).toBe(30);
		expect(blockMinutes(blockFor(NOTE, ['Systems']))).toBe(DEFAULT_MINUTES);
		expect(blockMinutes(null)).toBe(DEFAULT_MINUTES);
	});
});

describe('withBullet', () => {
	it('files the bullet after the existing sub-bullets, one tab deeper, and changes nothing else', () => {
		const block = blockFor(NOTE, ['Fullstack'])!;
		const next = withBullet(NOTE, block, '- Fullstack: step, 25m, done');
		const before = NOTE.split('\n');
		const after = next.split('\n');
		expect(after).toHaveLength(before.length + 1);
		expect(after[4]).toBe('\t- Fullstack: step, 25m, done');
		expect([...after.slice(0, 4), ...after.slice(5)]).toEqual(before);
	});
});

describe('outcomeLine and loggedSessions', () => {
	it('round-trips, including a step with commas and scratch words', () => {
		const bullet = outcomeLine('Fullstack', 'Finish react.dev, chapter 2', 25, 'progress', 'got stuck\non state');
		expect(bullet).toBe('- Fullstack: Finish react.dev, chapter 2, 25m, progress · got stuck on state');
		expect(loggedSessions(`- [x] block\n\t${bullet}\nnoise`)).toEqual([{ subject: 'Fullstack', minutes: 25, outcome: 'progress' }]);
	});

	it('does not read an ordinary bullet as a session', () => {
		expect(loggedSessions('- Meeting: notes, 5m')).toEqual([]);
	});
});

describe('nextBlock', () => {
	const subjects = [
		{ slug: 'fullstack', names: ['Fullstack'] },
		{ slug: 'systems', names: ['Systems'] },
		{ slug: 'rust', names: ['Rust', 'leyline-frontline'] }
	];
	const day = ['# Tasks', '- [ ] 09:00 - 09:30 Study Systems', '- [ ] 17:00 - 17:30 Study Fullstack', '- [ ] 20:30 - 23:00 leyline-frontline', '- [ ] Study Systems later'].join('\n');
	const at = (h: number, m = 0) => nextBlock(day, subjects, h * 60 + m)?.subject.slug;

	it('is the soonest block still to come', () => {
		expect(at(8)).toBe('systems');
		expect(at(12)).toBe('fullstack');
		expect(at(18)).toBe('rust');
	});

	it('counts a block in progress as next', () => {
		expect(at(17, 10)).toBe('fullstack');
	});

	it('falls back to a block with no times, then to the latest that has ended', () => {
		expect(at(23, 30)).toBe('systems');
		const timedOnly = '- [ ] 09:00 - 09:30 Study Systems\n- [ ] 17:00 - 17:30 Study Fullstack';
		expect(nextBlock(timedOnly, subjects, 20 * 60)?.subject.slug).toBe('fullstack');
	});

	it('is null when nothing is blocked', () => {
		expect(nextBlock('- [ ] Meditate', subjects, 600)).toBeNull();
		expect(nextBlock('- [x] 09:00 - 09:30 Study Systems', subjects, 600)).toBeNull();
	});
});
