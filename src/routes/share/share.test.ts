import { describe, it, expect } from 'vitest';
import { shared } from './share';

const share = (fields: Record<string, string>) => shared(new URLSearchParams(fields));

describe('shared', () => {
	it('makes a link out of a browser share', () => {
		expect(share({ share_title: 'SM-2', share_url: 'https://example.com/sm2' })).toBe(
			'[SM-2](https://example.com/sm2)'
		);
	});

	it('keeps a note alongside the link', () => {
		expect(
			share({ share_title: 'SM-2', share_url: 'https://example.com/sm2', share_text: 'read this week' })
		).toBe('[SM-2](https://example.com/sm2) — read this week');
	});

	it('does not repeat a url that arrived as the text', () => {
		expect(share({ share_title: 'SM-2', share_text: 'https://example.com/sm2' })).toBe(
			'[SM-2](https://example.com/sm2)'
		);
	});

	it('does not repeat a title already inside the text', () => {
		expect(share({ share_title: 'SM-2', share_text: 'SM-2 is the algorithm' })).toBe('SM-2 is the algorithm');
	});

	it('takes plain text on its own', () => {
		expect(share({ share_text: 'ring the clinic back' })).toBe('ring the clinic back');
	});

	it('keeps a sentence and its url together', () => {
		expect(share({ share_text: 'worth reading', share_url: 'https://example.com/x' })).toBe(
			'worth reading https://example.com/x'
		);
	});

	it('is empty when nothing came through', () => {
		expect(share({})).toBe('');
	});
});
