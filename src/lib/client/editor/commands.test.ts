import { describe, it, expect } from 'vitest';
import { wrap, asCard, asCloze, asWikilink } from './commands';

/** Apply an edit and render the result with the selection marked by | |. */
function apply(doc: string, edit: ReturnType<typeof wrap>): string {
	const next = doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
	return next.slice(0, edit.selectFrom) + '|' + next.slice(edit.selectFrom, edit.selectTo) + '|' + next.slice(edit.selectTo);
}

describe('wrap', () => {
	it('bolds a selection and keeps it selected', () => {
		const doc = 'make this bold';
		expect(apply(doc, wrap(doc, 10, 14, '**'))).toBe('make this **|bold|**');
	});

	it('unbolds when the markers are just outside the selection', () => {
		const doc = 'make this **bold** again';
		expect(apply(doc, wrap(doc, 12, 16, '**'))).toBe('make this |bold| again');
	});

	it('unbolds when the markers are inside the selection', () => {
		const doc = 'make this **bold** again';
		expect(apply(doc, wrap(doc, 10, 18, '**'))).toBe('make this |bold| again');
	});

	it('inserts a pair and places the cursor between them when nothing is selected', () => {
		const doc = 'type here: ';
		expect(apply(doc, wrap(doc, 11, 11, '**'))).toBe('type here: **||**');
	});

	it('handles asymmetric markers', () => {
		const doc = 'see QMS now';
		expect(apply(doc, wrap(doc, 4, 7, '[[', ']]'))).toBe('see [[|QMS|]] now');
	});
});

describe('asCloze', () => {
	it('wraps in highlight markers', () => {
		const doc = 'the mitochondria is the powerhouse';
		expect(apply(doc, asCloze(doc, 4, 16))).toBe('the ==|mitochondria|== is the powerhouse');
	});

	it('is its own undo', () => {
		const doc = 'the ==mitochondria== is';
		expect(apply(doc, asCloze(doc, 6, 18))).toBe('the |mitochondria| is');
	});
});

describe('asCard', () => {
	it('turns the selection into a question and parks the cursor for the answer', () => {
		const doc = 'What is two’s complement';
		const edit = asCard(doc, 0, doc.length);
		expect(apply(doc, edit)).toBe('What is two’s complement::||');
	});

	it('trims the selection so a trailing space does not land inside the separator', () => {
		const doc = 'Define prosoche   ';
		expect(apply(doc, asCard(doc, 0, doc.length))).toBe('Define prosoche::||');
	});

	it('inserts a bare separator when nothing is selected', () => {
		const doc = 'Question';
		expect(apply(doc, asCard(doc, 8, 8))).toBe('Question::||');
	});
});

describe('asWikilink', () => {
	it('links a selection', () => {
		const doc = 'see Handbook';
		expect(apply(doc, asWikilink(doc, 4, 12))).toBe('see [[|Handbook|]]');
	});
});
