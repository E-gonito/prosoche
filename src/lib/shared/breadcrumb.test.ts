import { describe, it, expect } from 'vitest';
import { collapseBreadcrumb } from './breadcrumb';

describe('collapseBreadcrumb', () => {
	it('leaves a trail with no repeats alone', () => {
		expect(collapseBreadcrumb('Scheduling › Algorithms')).toBe('Scheduling › Algorithms');
	});

	it('collapses one repeated segment', () => {
		expect(collapseBreadcrumb('Scheduling › Scheduling › Algorithms')).toBe('Scheduling › Algorithms');
	});

	it('collapses a run of more than two identical segments', () => {
		expect(collapseBreadcrumb('A › A › A › B')).toBe('A › B');
	});

	it('only collapses segments that are consecutive', () => {
		expect(collapseBreadcrumb('A › B › A')).toBe('A › B › A');
	});

	it('leaves a single segment, or an empty string, alone', () => {
		expect(collapseBreadcrumb('Algorithms')).toBe('Algorithms');
		expect(collapseBreadcrumb('')).toBe('');
	});
});
