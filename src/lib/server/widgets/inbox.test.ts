import { describe, it, expect } from 'vitest';
import { captureLines } from './inbox';

const CAPTURE = [
	'# Capture',
	'',
	'## 2026-09-21',
	'- 09:12 Ask about the grading walkthrough',
	'- [ ] 09:20 Chase the QMS documents',
	'- [-] 09:30 Already filed',
	'- [x] 09:40 Already done',
	'',
	'## 2026-09-20',
	'- 17:02 Book the dentist',
	'A paragraph someone typed straight in.',
	''
].join('\n');

describe('captureLines', () => {
	const lines = captureLines(CAPTURE);

	it('leaves out headings, blanks, and anything already dealt with', () => {
		expect(lines.map((l) => l.text)).toEqual([
			'A paragraph someone typed straight in.',
			'Book the dentist',
			'Chase the QMS documents',
			'Ask about the grading walkthrough'
		]);
	});

	it('is newest first, which is the order they will be looked at', () => {
		expect(lines[0].line).toBeGreaterThan(lines[lines.length - 1].line);
	});

	it('carries the raw line, so a filing proposal can refuse a stale page', () => {
		const chase = lines.find((l) => l.text === 'Chase the QMS documents');
		expect(chase?.raw).toBe('- [ ] 09:20 Chase the QMS documents');
		expect(CAPTURE.split('\n')[chase!.line]).toBe(chase?.raw);
	});

	it('remembers which day a line was captured on', () => {
		expect(lines.find((l) => l.text === 'Book the dentist')?.day).toBe('2026-09-20');
		expect(lines.find((l) => l.text === 'Chase the QMS documents')?.day).toBe('2026-09-21');
	});

	it('keeps a paragraph someone typed straight in', () => {
		expect(lines.some((l) => l.text.startsWith('A paragraph'))).toBe(true);
	});

	it('is empty for a note with only a title', () => {
		expect(captureLines('# Capture\n')).toEqual([]);
	});
});
