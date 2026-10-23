import { describe, it, expect } from 'vitest';
import { bookHitHref } from './book-links';

describe('bookHitHref', () => {
	it.each([
		[{ book: 'abc123', place: { kind: 'page', page: 412 } }, ' linker ', '/books/abc123?at=p.%20412&find=linker'],
		[{ book: 's-1', place: { kind: 'html', chapter: 'ch04-02.html', anchor: 'the-rules' } }, 'borrow checker', '/books/s-1?at=ch04-02.html%23the-rules&find=borrow%20checker'],
		[{ book: 'e1', place: { kind: 'html', chapter: 'OEBPS/Chapter 1.xhtml' } }, 'a&b=c', '/books/e1?at=OEBPS%2FChapter%201.xhtml&find=a%26b%3Dc']
	] as const)('%j with %j', (hit, query, href) => {
		expect(bookHitHref({ book: hit.book, place: hit.place as never }, query)).toBe(href);
	});
});
