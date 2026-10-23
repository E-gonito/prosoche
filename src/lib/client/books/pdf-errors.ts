/**
 * What to tell the reader when pdf.js cannot open a book, in words. pdf.js
 * names its failures (`MissingPDFException` and the like) and, for a bad
 * HTTP answer, carries the status. Pure; never throws.
 */
export function describeLoadError(err: unknown): string {
	const e = (err ?? {}) as { name?: unknown; status?: unknown; message?: unknown };
	const name = typeof e.name === 'string' ? e.name : '';
	const status = typeof e.status === 'number' ? e.status : 0;
	if (name === 'MissingPDFException' || status === 404) return "This book's file isn't on the server. Upload it again from Books.";
	if (name === 'InvalidPDFException') return "This file isn't a PDF the reader can open. Upload it again from Books.";
	if (name === 'PasswordException') return "This PDF is locked with a password, which the reader can't open.";
	if (status === 401 || status === 403) return 'The server refused to send this book. Sign in again, then reload.';
	if (name === 'UnexpectedResponseException') return `The server answered the book's file in a way the reader could not use${status ? ` (status ${status})` : ''}. Reload to try again.`;
	if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'No connection. Reload when you are back online.';
	const detail = typeof e.message === 'string' && e.message ? ` (${e.message})` : '';
	return `The book could not be opened${detail}. Reload to try again.`;
}
