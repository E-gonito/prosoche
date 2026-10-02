import { describe, it, expect } from 'vitest';
import { formatDuration } from './duration';

describe('formatDuration', () => {
	const cases: Array<[number, string]> = [
		[83, '1h23m'],
		[120, '2h'],
		[45, '45m'],
		[0, '0m'],
		[1, '1m'],
		[1445, '24h5m'],
		[-5, '0m'],
		[59.6, '1h']
	];
	for (const [input, expected] of cases) {
		it(`writes ${input} as ${expected}`, () => {
			expect(formatDuration(input)).toBe(expected);
		});
	}
});
