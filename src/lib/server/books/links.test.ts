import { describe, it, expect } from 'vitest';
import { bookForLink, bookLink } from './links';
import type { BookSummary } from '$lib/shared/books';

const book = (id: string, note: string): BookSummary => ({
	id,
	note,
	title: note.slice(6, -3),
	format: 'pdf',
	source: 'x.pdf',
	at: { kind: 'page', page: 12 },
	atLabel: 'p. 12 of 40',
	readAt: null,
	onShelf: true
});

const books = [book('0123456789abcdef', 'Books/The Rust Book.md'), book('fedcba9876543210', 'Books/CS-APP.md')];

describe('bookForLink', () => {
	it.each([
		['Books/The%20Rust%20Book.md', '0123456789abcdef'],
		['<Books/The Rust Book.md>', '0123456789abcdef'],
		['Books/The Rust Book', '0123456789abcdef'],
		['/Books/CS-APP.md', 'fedcba9876543210'],
		['/books/fedcba9876543210', 'fedcba9876543210'],
		['books/fedcba9876543210/', 'fedcba9876543210']
	])('%s is a book', (url, id) => {
		expect(bookForLink(url, books)?.id).toBe(id);
	});

	it.each([[null], [''], ['https://csapp.cs.cmu.edu'], ['Books/Missing.md'], ['Notes/CS-APP.md'], ['/books/0000000000000000'], ['Books/%E0%A4%A.md']])(
		'%s is not',
		(url) => {
			expect(bookForLink(url, books)).toBeNull();
		}
	);
});

describe('bookLink', () => {
	it('opens the reader and says where the author is', () => {
		expect(bookLink(books[1])).toEqual({ id: 'fedcba9876543210', href: '/books/fedcba9876543210', title: 'CS-APP', at: 'p. 12 of 40' });
	});
});
