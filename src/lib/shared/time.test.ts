import { describe, it, expect } from 'vitest';
import { formatMinutes } from './time';

describe('formatMinutes', () => {
	it('writes minutes since midnight as a clock', () => {
		expect(formatMinutes(0)).toBe('00:00');
		expect(formatMinutes(9 * 60 + 5)).toBe('09:05');
		expect(formatMinutes(23 * 60 + 59)).toBe('23:59');
	});
});
