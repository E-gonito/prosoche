import { describe, it, expect } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
	it('lowercases and joins words with single hyphens', () => {
		expect(slugify('Side Projects')).toBe('side-projects');
		expect(slugify('  Kanban   board  ')).toBe('kanban-board');
	});

	it('drops punctuation rather than encoding it', () => {
		expect(slugify("Tom's list (2026)")).toBe('tom-s-list-2026');
	});

	it('never ends on a hyphen, even after truncation', () => {
		expect(slugify('a'.repeat(47) + ' b')).not.toMatch(/-$/);
		expect(slugify('!!!')).toBe('');
	});

	it('is stable when applied twice', () => {
		const once = slugify('In Progress / Review');
		expect(slugify(once)).toBe(once);
	});
});
