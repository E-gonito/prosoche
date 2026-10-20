import { describe, expect, it } from 'vitest';
import { formatAttempt, logFileFor, parseAttempts } from './attempts';
import type { Attempt } from '$lib/shared/tactics';

const base: Attempt = {
	at: '2026-10-20T21:14:03',
	scenario: 'ron-0001',
	mission: 'm-20261020-2114',
	answer: ['B'],
	result: 'in-time',
	correct: true,
	ms: 2310,
	roe: false,
	device: 'pc'
};

describe('attempt log', () => {
	it.each<[string, Attempt]>([
		['a choice', base],
		['a clear order', { ...base, answer: ['A1', 'A3', 'A2'] }],
		['a timeout', { ...base, answer: null, result: 'timeout', correct: false }],
		['an ROE violation on a phone', { ...base, answer: ['A'], result: 'wrong', correct: false, roe: true, device: 'phone' }]
	])('reads back %s as written', (_name, attempt) => {
		expect(parseAttempts(formatAttempt(attempt))).toEqual([attempt]);
	});

	it('writes the line the brief describes', () => {
		expect(formatAttempt(base)).toBe(
			'- 2026-10-20T21:14:03 ron-0001 answer:: B result:: in-time correct:: true ms:: 2310 roe:: false mission:: m-20261020-2114 device:: pc'
		);
	});

	it('skips a heading, prose and a line with no result', () => {
		const content = `# Tactics attempts, 2026-10\n\nA note of mine.\n${formatAttempt(base)}\n- 2026-10-20T21:15:00 ron-0002 answer:: B\n`;
		expect(parseAttempts(content)).toHaveLength(1);
	});

	it('files an attempt by its month', () => {
		expect(logFileFor('2026-10-20T21:14:03')).toBe('2026-10.md');
	});
});
