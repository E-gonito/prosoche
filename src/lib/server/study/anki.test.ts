import { describe, it, expect } from 'vitest';
import { ankiDeck, ankiFilename } from './anki';
import { scanCards } from './flashcards';
import type { Card } from '$lib/shared/study';

const card = (question: string, answer: string): Card =>
	({
		path: 'CS/x.md',
		line: 0,
		endLine: 0,
		kind: 'inline',
		question,
		answer,
		context: '',
		deck: 'CS',
		schedule: null,
		index: 0,
		siblings: 1,
		scheduleLine: 0,
		scheduleExists: false,
		expectedRaw: ''
	}) as Card;

describe('ankiDeck', () => {
	it('writes the header this user’s own exports use', () => {
		const out = ankiDeck([card('Q', 'A')], { name: 'CS::Cyber Security', tags: ['CS', 'Cyber', 'Security'] });
		expect(out.split('\n').slice(0, 5)).toEqual([
			'#separator:Tab',
			'#html:true',
			'#deck:CS::Cyber Security',
			'#tags:CS Cyber Security',
			''
		]);
	});

	it('separates the two sides with a tab and nothing else', () => {
		expect(ankiDeck([card('Q', 'A')], { name: 'CS' })).toContain('Q\tA');
	});

	it('encodes a newline the way the existing decks do', () => {
		expect(ankiDeck([card('Q', 'one\ntwo')], { name: 'CS' })).toContain('Q\tone&lt;br&gt;two');
	});

	it('escapes html so a code sample cannot become markup', () => {
		expect(ankiDeck([card('Q', 'if (a < b && c > d)')], { name: 'CS' })).toContain('if (a &lt; b &amp;&amp; c &gt; d)');
	});

	it('turns a stray tab into a space, so the columns cannot shift', () => {
		expect(ankiDeck([card('Q\there', 'A')], { name: 'CS' })).toContain('Q here\tA');
	});

	it('leaves the schedule comment out, since only Obsidian understands it', () => {
		const [live] = scanCards('#flashcards\n\nQ::A\n<!--SR:!2026-09-21,4,270-->\n', 'CS/x.md');
		expect(ankiDeck([live], { name: 'CS' })).not.toContain('SR:');
	});

	it('exports an empty deck as a header rather than an error', () => {
		expect(ankiDeck([], { name: 'CS' })).toBe('#separator:Tab\n#html:true\n#deck:CS\n\n');
	});
});

describe('ankiFilename', () => {
	it('is a file name, never a path', () => {
		expect(ankiFilename('CS::Cyber Security')).toBe('CS - Cyber Security.txt');
		expect(ankiFilename('../../etc/passwd')).toBe('.._.._etc_passwd.txt');
		expect(ankiFilename('')).toBe('flashcards.txt');
	});
});
