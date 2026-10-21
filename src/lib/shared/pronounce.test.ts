import { describe, expect, it } from 'vitest';
import { forvoHref, isLanguageCode, pickVoice } from './pronounce';

describe('forvoHref', () => {
	it('lower-cases the word and joins a phrase with underscores', () => {
		expect(forvoHref('Magandang umaga', 'tl')).toBe('https://forvo.com/word/magandang_umaga/#tl');
		expect(forvoHref(' Kumusta ', 'tl')).toBe('https://forvo.com/word/kumusta/#tl');
	});

	it('encodes what a URL cannot carry', () => {
		expect(forvoHref('niño', 'es')).toBe('https://forvo.com/word/ni%C3%B1o/#es');
	});
});

describe('pickVoice', () => {
	const voices = [{ lang: 'en-GB', name: 'a' }, { lang: 'fil-PH', name: 'b' }, { lang: 'tl_PH', name: 'c' }];

	it('finds a voice by any of the language’s tags, whatever the region or separator', () => {
		expect(pickVoice(voices, 'tl')?.name).toBe('b');
		expect(pickVoice(voices.slice(2), 'tl')?.name).toBe('c');
	});

	it('is undefined when the device has none, so the button can hide', () => {
		expect(pickVoice([{ lang: 'en-GB' }], 'tl')).toBeUndefined();
		expect(pickVoice([], 'es')).toBeUndefined();
	});
});

describe('isLanguageCode', () => {
	it('takes two or three lower-case letters only', () => {
		expect(['tl', 'fil', 'es'].every(isLanguageCode)).toBe(true);
		expect(['', 'TL', 'tagalog', 'tl-PH', 3, null].some(isLanguageCode)).toBe(false);
	});
});
