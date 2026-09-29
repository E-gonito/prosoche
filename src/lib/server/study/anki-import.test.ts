import { describe, it, expect } from 'vitest';
import { cardBlock, deckNote, deckTag, htmlToMarkdown, parseAnkiDeck, type AnkiDeckFile } from './anki-import';
import { isCardSource, scanCards } from './flashcards';
import { parseNote } from '../parse/note';

/** A deck file in the shape the user's exports have, header and all. */
function deck(rows: string[], header = ['#separator:Tab', '#html:true', '#deck:CS::Networking', '#tags:CS Networking', '']): string {
	return [...header, ...rows, ''].join('\n');
}

/** A deck's note read back by the same card finder review uses. */
function readBack(file: AnkiDeckFile) {
	const note = deckNote(file, 'Flashcards/CS/Deck.txt');
	return scanCards(note, 'Study/Flashcards/CS/Deck.md').map((c) => ({ kind: c.kind, front: c.question, back: c.answer }));
}

describe('htmlToMarkdown', () => {
	const cases: Array<[string, string, string]> = [
		['a real line break', 'one<br>two<br/>three', 'one\ntwo\nthree'],
		['the escaped line break these exports use', 'one&lt;br&gt;two', 'one\ntwo'],
		['bold and italic', '<b>bold</b>, <strong>strong</strong>, <i>it</i> and <em>em</em>', '**bold**, **strong**, *it* and *em*'],
		['space just inside a mark moved outside it', 'a<b> word </b>b', 'a **word** b'],
		['an empty mark dropped', 'a<b> </b>b', 'a b'],
		['an unordered list', '<ul><li>one</li><li>two</li></ul>', '\n- one\n- two\n'],
		['an ordered list', '<ol><li>first</li><li>second</li></ol>', '\n1. first\n2. second\n'],
		['a nested list', '<ul><li>a<ul><li>b</li></ul></li></ul>', '\n- a\n  - b\n'],
		['list items HTML leaves open', '<ul><li>a<li>b</ul>', '\n- a\n- b\n'],
		['an image', 'see <img src="diagram.png" alt="flow">', 'see ![flow](diagram.png)'],
		['an image with a space in its name', '<img src="My diagram.png">', '![](<My diagram.png>)'],
		['a link', '<a href="https://example.com/a?b=1&amp;c=2">docs</a>', '[docs](https://example.com/a?b=1&c=2)'],
		['entities', 'Tom &amp; Jerry&nbsp;&lt;3 &#39;hi&#39; &#x2192; &quot;q&quot; &hellip;', 'Tom & Jerry <3 \'hi\' → "q" …'],
		['escaped markup kept as text, not stripped as a tag', 'Vec&lt;String&gt; and &lt;Button&gt;', 'Vec<String> and <Button>'],
		['a double-escaped entity decoded once', 'a &amp;gt; b', 'a &gt; b'],
		['code in pre as a fence, blank lines and all', '<pre>let a = 1;<br><br>if a &lt; 2 {}</pre>', '\n```\nlet a = 1;\n\nif a < 2 {}\n```\n'],
		['marks inside pre left out', '<pre><b>x</b> = 1</pre>', '\n```\nx = 1\n```\n'],
		['a pre holding a fence uses tildes', '<pre>```js<br>x<br>```</pre>', '\n~~~\n```js\nx\n```\n~~~\n'],
		['inline code', 'run <code>ls -la</code>', 'run `ls -la`'],
		['divs and paragraphs as lines', '<div>one</div><p>two</p>', '\none\n\ntwo\n'],
		['a heading as a bold line', '<h3>Background</h3>text', '\n**Background**\ntext'],
		['unknown tags dropped, their text kept', '<span style="color:red">red</span> <font size=2>small</font>', 'red small'],
		['comments dropped', 'a<!-- note -->b', 'ab'],
		['a review comment dropped, escaped or not', 'answer&lt;br&gt;&lt;!--SR:!2025-12-21,4,270--&gt;<!--SR:!2025-12-21,4,270-->', 'answer\n'],
		['raw newlines are spaces, as in HTML', 'one\ntwo', 'one two']
	];

	it.each(cases)('converts %s', (_what, html, markdown) => {
		expect(htmlToMarkdown(html)).toBe(markdown);
	});
});

describe('parseAnkiDeck', () => {
	it('reads the headers and every row of a real-shaped deck', () => {
		const file = parseAnkiDeck(
			deck([
				'What is Bandit Level 1?\tThe password is in a file called **-**&lt;br&gt;1. cat ./-&lt;br&gt;2. 263JGJ',
				'What is Bandit Level 2?\tIn a file with spaces&lt;br&gt;&lt;!--SR:!2025-12-21,4,270--&gt;',
				'',
				'What is Evaluation?\ttesting claims against evidence'
			]),
			'Flashcards/Computer Science/Cyber Security/OverTheWire.txt'
		);
		expect(file.deck).toBe('CS::Networking');
		expect(file.tags).toEqual(['CS', 'Networking']);
		expect(file.problems).toEqual([]);
		expect(file.cards).toEqual([
			{ front: 'What is Bandit Level 1?', back: 'The password is in a file called **-**\n1. cat ./-\n2. 263JGJ' },
			{ front: 'What is Bandit Level 2?', back: 'In a file with spaces' },
			{ front: 'What is Evaluation?', back: 'testing claims against evidence' }
		]);
	});

	it('names a deck with no #deck: header after its path', () => {
		const file = parseAnkiDeck('Q\tA\n', 'Flashcards/Computer Science/LeetCode/TwoSum.txt');
		expect(file.deck).toBe('Computer Science::LeetCode::TwoSum');
		expect(file.cards).toEqual([{ front: 'Q', back: 'A' }]);
	});

	it('honours quoted fields holding tabs, newlines and doubled quotes', () => {
		const file = parseAnkiDeck(deck(['"Say ""hi"""\t"one\ttab<br>two"', 'Next\tOne']), 'Flashcards/x.txt');
		expect(file.cards).toEqual([
			{ front: 'Say "hi"', back: 'one\ttab\ntwo' },
			{ front: 'Next', back: 'One' }
		]);
	});

	it('reads a quoted field that runs over several lines, and numbers later lines right', () => {
		const file = parseAnkiDeck(deck(['"A"\t"line one', 'line two"', 'lonely']), 'Flashcards/x.txt');
		expect(file.cards).toEqual([{ front: 'A', back: 'line one line two' }]);
		expect(file.problems).toEqual(['Line 8: no answer column; skipped.']);
	});

	it('keeps the first two columns and says once that there were more', () => {
		const file = parseAnkiDeck(deck(['Q1\tA1\textra', 'Q2\tA2\textra\tmore']), 'Flashcards/x.txt');
		expect(file.cards.map((c) => c.back)).toEqual(['A1', 'A2']);
		expect(file.problems).toEqual(['2 rows have more than two columns; only the first two were kept.']);
	});

	it('skips the columns a `column:` header claims', () => {
		const header = ['#separator:Tab', '#html:true', '#notetype column:1', '#deck column:2', ''];
		const file = parseAnkiDeck(deck(['Basic\tCS\tQ\tA'], header), 'Flashcards/x.txt');
		expect(file.cards).toEqual([{ front: 'Q', back: 'A' }]);
		expect(file.problems).toEqual([]);
	});

	it('reads a first card that starts with # as a card, not a header', () => {
		const file = parseAnkiDeck('#separator:Tab\n#include <stdio.h>: what for?\tprintf\n', 'Flashcards/x.txt');
		expect(file.cards).toEqual([{ front: '\\#include <stdio.h>: what for?', back: 'printf' }]);
	});

	it('reads another separator Anki names', () => {
		const file = parseAnkiDeck(deck(['Q;A'], ['#separator:Semicolon', '#html:true', '']), 'Flashcards/x.txt');
		expect(file.cards).toEqual([{ front: 'Q', back: 'A' }]);
	});

	it('leaves markup alone when the deck says it is not HTML', () => {
		const file = parseAnkiDeck(deck(['<b>Q</b>\tA &amp; B'], ['#separator:Tab', '#html:false', '']), 'Flashcards/x.txt');
		expect(file.cards).toEqual([{ front: '<b>Q</b>', back: 'A &amp; B' }]);
	});

	it('skips and reports a card with an empty side', () => {
		const file = parseAnkiDeck(deck(['Q\t&lt;!--SR:!2025-12-21,4,270--&gt;', '\tA', 'Fine\tYes']), 'Flashcards/x.txt');
		expect(file.cards).toEqual([{ front: 'Fine', back: 'Yes' }]);
		expect(file.problems).toEqual(['Line 6: the answer is empty; skipped.', 'Line 7: the question is empty; skipped.']);
	});
});

/**
 * Every row here is text the card finder would read as something other than
 * the card it is: a separator inside a side, a line that is the multiline
 * separator, a heading or a blank line that would end the card, a fence that
 * would swallow the rest of the file. Each one must come back out of the
 * written note as exactly the card that went in.
 */
describe('cards that would be misread as card syntax', () => {
	const cases: Array<{ what: string; row: string; kind: 'inline' | 'multiline'; front: string; back: string }> = [
		{ what: 'a plain one-line card', row: 'What is HTTP?\tA protocol', kind: 'inline', front: 'What is HTTP?', back: 'A protocol' },
		{ what: 'a Rust path in the question', row: 'What is std::io?\tThe I/O module', kind: 'multiline', front: 'What is std::io?', back: 'The I/O module' },
		{ what: 'a Rust path in the answer', row: 'How to read a line\tstd::io::stdin', kind: 'multiline', front: 'How to read a line', back: 'std::io::stdin' },
		{ what: 'a triple colon in the answer', row: 'Q\ta:::b', kind: 'multiline', front: 'Q', back: 'a:::b' },
		{ what: 'a question ending in a colon', row: 'Definition:\tA thing', kind: 'multiline', front: 'Definition:', back: 'A thing' },
		{ what: 'an answer starting with a colon', row: 'Q\t:root selector', kind: 'multiline', front: 'Q', back: ':root selector' },
		{ what: 'a Rust path inside inline code', row: 'Build one\t`String::from`', kind: 'multiline', front: 'Build one', back: '`String::from`' },
		{ what: 'an unclosed backtick in the question', row: 'What does ` start?\tInline code', kind: 'multiline', front: 'What does ` start?', back: 'Inline code' },
		{ what: 'a lone ? line in the answer', row: 'Q\tfirst&lt;br&gt;?&lt;br&gt;last', kind: 'multiline', front: 'Q', back: 'first\n\\?\nlast' },
		{ what: 'a lone ? line in the question', row: 'What is&lt;br&gt;?&lt;br&gt;this\tA', kind: 'multiline', front: 'What is\n\\?\nthis', back: 'A' },
		{ what: 'a lone ?? line', row: 'Q\ta&lt;br&gt;??&lt;br&gt;b', kind: 'multiline', front: 'Q', back: 'a\n\\?\\?\nb' },
		{ what: 'a question that is only ?', row: '?\tA', kind: 'inline', front: '\\?', back: 'A' },
		{ what: 'a cloze-shaped highlight', row: 'Q\tthe ==key== idea', kind: 'inline', front: 'Q', back: 'the ==key== idea' },
		{ what: 'a heading in the answer', row: 'Q\t#### Background&lt;br&gt;text', kind: 'multiline', front: 'Q', back: '**Background**\ntext' },
		{ what: 'blank lines in the answer', row: 'Q\tone&lt;br&gt;&lt;br&gt;two', kind: 'multiline', front: 'Q', back: 'one\ntwo' },
		{ what: 'a rule under a line', row: 'Q\tone&lt;br&gt;&lt;br&gt;---&lt;br&gt;two&lt;br&gt;---', kind: 'multiline', front: 'Q', back: 'one\n***\ntwo' },
		{ what: 'a tag in prose, but not in code', row: 'Q\tassert x #Comparison `#keep`', kind: 'inline', front: 'Q', back: 'assert x \\#Comparison `#keep`' },
		{ what: 'a review comment', row: 'Q\tA&lt;br&gt;&lt;!--SR:!2025-12-21,4,270--&gt;', kind: 'inline', front: 'Q', back: 'A' },
		{
			what: 'code holding a separator, a ? line and a blank line',
			row: 'Q\tRun it:<pre>use std::io;<br><br>?<br>fn main() {}</pre>',
			kind: 'multiline',
			front: 'Q',
			back: 'Run it:\n```\nuse std::io;\n\n?\nfn main() {}\n```'
		},
		{
			what: 'a fence the text never closes',
			row: 'Q\tsee&lt;br&gt;```js&lt;br&gt;let a = 1',
			kind: 'multiline',
			front: 'Q',
			back: 'see\n```js\nlet a = 1\n```'
		},
		{ what: 'a non-breaking space', row: 'Q\ta b&nbsp;c', kind: 'inline', front: 'Q', back: 'a b c' }
	];

	it.each(cases)('keeps $what', ({ row, kind, front, back }) => {
		const file = parseAnkiDeck(deck([row, 'After\tStill its own card']), 'Flashcards/CS/Deck.txt');
		expect(file.problems).toEqual([]);
		expect(file.cards[0]).toEqual({ front, back });
		// The card after it proves nothing above leaked out of its paragraph.
		expect(readBack(file)).toEqual([
			{ kind, front, back },
			{ kind: 'inline', front: 'After', back: 'Still its own card' }
		]);
	});

	it('reads back every card of a mixed deck, in order', () => {
		const file = parseAnkiDeck(deck(cases.map((c) => c.row)), 'Flashcards/CS/Deck.txt');
		expect(file.cards).toHaveLength(cases.length);
		expect(readBack(file)).toEqual(cases.map(({ kind, front, back }) => ({ kind, front, back })));
	});
});

describe('deckNote', () => {
	it('writes frontmatter, the deck tag and each card as its own paragraph', () => {
		const file = parseAnkiDeck(deck(['What is HTTP?\tA protocol', 'What is TCP?\tReliable&lt;br&gt;ordered']), 'Flashcards/CS/Networking/HTTP.txt');
		expect(deckNote(file, 'Flashcards/CS/Networking/HTTP.txt')).toBe(
			[
				'---',
				'goal:',
				'source: Flashcards/CS/Networking/HTTP.txt',
				'---',
				'',
				'#flashcards/cs/networking',
				'',
				'What is HTTP?::A protocol',
				'',
				'What is TCP?',
				'?',
				'Reliable',
				'ordered',
				''
			].join('\n')
		);
	});

	it('is a card source with no goal and the right deck', () => {
		const file = parseAnkiDeck(deck(['Q\tA']), 'Flashcards/CS/Networking/HTTP.txt');
		const note = deckNote(file, 'Flashcards/CS/Networking/HTTP.txt');
		const parsed = parseNote(note, 'Study/Flashcards/CS/Networking/HTTP.md');
		expect(parsed.frontmatter.goal).toBeNull();
		expect(isCardSource(parsed.tags, note)).toBe(true);
		expect(scanCards(note, 'Study/Flashcards/CS/Networking/HTTP.md')[0].deck).toBe('cs/networking');
	});

	it.each([
		'Flashcards/Wisdom/Books/CS-APP - Randal E. Bryant and David R. O\'Hallaron, Carnegie Mellon University.txt',
		'Flashcards/CS/Deep Learning & Neural Networks with Keras and Tensor Flow.txt',
		'Flashcards/CS/Closure & Lexical Environment.txt',
		'Flashcards/Notes: part #1.txt',
		"Flashcards/'quoted'.txt",
		'Flashcards/1071. Greatest Common Divisor of Strings.txt'
	])('writes a source YAML reads back unchanged: %s', (source) => {
		const note = deckNote(parseAnkiDeck('Q\tA\n', source), source);
		expect(parseNote(note).frontmatter.source).toBe(source);
	});
});

describe('deckTag', () => {
	it.each([
		['CS', 'flashcards/cs'],
		['CS::Cyber Security', 'flashcards/cs/cyber-security'],
		['CS::Courses::IBM AI Engineering::AI-A modern Apporach', 'flashcards/cs/courses/ibm-ai-engineering/ai-a-modern-apporach'],
		['Wisdom::Study and Mindset tips folder', 'flashcards/wisdom/study-and-mindset-tips-folder'],
		['::', 'flashcards']
	])('tags %s as %s', (deckName, tag) => {
		expect(deckTag(deckName)).toBe(tag);
	});
});

describe('cardBlock', () => {
	it.each([
		{ what: 'a one-line card', front: 'What is TCP?', back: 'A transport protocol', markdown: 'What is TCP?::A transport protocol' },
		{ what: 'a Rust path', front: 'Read a line with?', back: 'std::io::stdin', markdown: 'Read a line with?\n?\nstd::io::stdin' },
		{ what: 'a side over two lines', front: 'Q', back: 'one\ntwo', markdown: 'Q\n?\none\ntwo' },
		{ what: 'a blank line typed into the answer', front: 'Q', back: 'one\n\ntwo', markdown: 'Q\n?\none\ntwo' },
		{ what: 'a heading typed into the answer', front: 'Q', back: '## Big\nsmall', markdown: 'Q\n?\n**Big**\nsmall' },
		{ what: 'a tag in the question', front: 'What is #TCP?', back: 'A protocol', markdown: 'What is \\#TCP?::A protocol' },
		{ what: 'a lone ? line', front: 'Q', back: 'a\n?\nb', markdown: 'Q\n?\na\n\\?\nb' },
		{ what: 'Windows line endings', front: 'Q', back: 'one\r\ntwo', markdown: 'Q\n?\none\ntwo' }
	])('writes $what so it reads back as itself', ({ front, back, markdown }) => {
		const block = cardBlock(front, back);
		expect(block?.markdown).toBe(markdown);
		const found = scanCards(`#flashcards\n\n${block!.markdown}\n\nAfter::Its own card\n`, 'x.md');
		expect(found.map((c) => [c.question, c.answer])).toEqual([
			[block!.card.front, block!.card.back],
			['After', 'Its own card']
		]);
	});

	it.each([
		{ what: 'a one-line card', front: 'VPC', back: 'A virtual network', markdown: 'VPC\n??\nA virtual network' },
		{ what: 'a Rust path', front: 'std::io', back: 'Rust’s I/O module', markdown: 'std::io\n??\nRust’s I/O module' },
		{ what: 'a definition and its relevance line', front: 'CDK', back: 'Infra as code.\n\n→ How eye2gene deploys.', markdown: 'CDK\n??\nInfra as code.\n→ How eye2gene deploys.' },
		{ what: 'a term that is only ??', front: '??', back: 'Nullish coalescing', markdown: '\\?\\?\n??\nNullish coalescing' }
	])('writes $what in the reversed form when asked', ({ front, back, markdown }) => {
		const block = cardBlock(front, back, 'reversed');
		expect(block?.markdown).toBe(markdown);
		const found = scanCards(`#flashcards\n\n${block!.markdown}\n`, 'x.md');
		expect(found.map((c) => [c.kind, c.question, c.answer])).toEqual([['multiline-reversed', block!.card.front, block!.card.back]]);
	});

	it.each([
		['an empty question', '  ', 'A'],
		['an answer that is only blank lines', 'Q', '\n\n'],
		['an answer that is only a review comment', 'Q', '<!--SR:!2026-01-01,1,250-->']
	])('refuses %s', (_, front, back) => {
		expect(cardBlock(front, back)).toBeNull();
	});
});
