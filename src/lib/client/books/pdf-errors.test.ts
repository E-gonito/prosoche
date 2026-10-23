import { describe, expect, test } from 'vitest';
import { describeLoadError } from './pdf-errors';

describe('describeLoadError', () => {
	test.each([
		[{ name: 'MissingPDFException' }, "This book's file isn't on the server. Upload it again from Books."],
		[{ name: 'UnexpectedResponseException', status: 404 }, "This book's file isn't on the server. Upload it again from Books."],
		[{ name: 'InvalidPDFException' }, /isn't a PDF/],
		[{ name: 'PasswordException' }, /password/],
		[{ name: 'UnexpectedResponseException', status: 500 }, /status 500/],
		[{ status: 403 }, /refused/],
		[new Error('boom'), /boom/],
		[null, /could not be opened/]
	])('%j', (err, want) => {
		const text = describeLoadError(err);
		if (typeof want === 'string') expect(text).toBe(want);
		else expect(text).toMatch(want);
	});
});
