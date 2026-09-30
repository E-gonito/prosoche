import { describe, it, expect } from 'vitest';
import { cardBlock } from './card-block';
import { scanCards } from './cards';

describe('cardBlock', () => {
	it.each([
		{ what: 'a one-line card', front: 'VPC', back: 'A virtual network', markdown: 'VPC\n??\nA virtual network' },
		{ what: 'a Rust path', front: 'std::io', back: 'Rust’s I/O module', markdown: 'std::io\n??\nRust’s I/O module' },
		{ what: 'a definition and its relevance line', front: 'CDK', back: 'Infra as code.\n\n→ How eye2gene deploys.', markdown: 'CDK\n??\nInfra as code.\n→ How eye2gene deploys.' },
		{ what: 'a term that is only ??', front: '??', back: 'Nullish coalescing', markdown: '\\?\\?\n??\nNullish coalescing' },
		{ what: 'a side over two lines', front: 'Q', back: 'one\ntwo', markdown: 'Q\n??\none\ntwo' },
		{ what: 'a heading typed into the answer', front: 'Q', back: '## Big\nsmall', markdown: 'Q\n??\n**Big**\nsmall' },
		{ what: 'a tag in the question', front: 'What is #TCP?', back: 'A protocol', markdown: 'What is \\#TCP?\n??\nA protocol' },
		{ what: 'a lone ? line', front: 'Q', back: 'a\n?\nb', markdown: 'Q\n??\na\n\\?\nb' },
		{ what: 'Windows line endings', front: 'Q', back: 'one\r\ntwo', markdown: 'Q\n??\none\ntwo' }
	])('writes $what so it reads back as itself, both ways', ({ front, back, markdown }) => {
		const block = cardBlock(front, back);
		expect(block?.markdown).toBe(markdown);
		const found = scanCards(`#flashcards\n\n${block!.markdown}\n\nAfter::Its own card\n`, 'x.md');
		expect(found.map((c) => [c.kind, c.question, c.answer])).toEqual([
			['multiline-reversed', block!.card.front, block!.card.back],
			['inline', 'After', 'Its own card']
		]);
	});

	it.each([
		['an empty question', '  ', 'A'],
		['an answer that is only blank lines', 'Q', '\n\n'],
		['an answer that is only a review comment', 'Q', '<!--SR:!2026-01-01,1,250-->'],
		['an answer that is only prosoche’s review comment', 'Q', '<!--fsrs:2026-10-02,3.21,5.8,4,0,review,2026-09-29-->']
	])('refuses %s', (_, front, back) => {
		expect(cardBlock(front, back)).toBeNull();
	});
});
