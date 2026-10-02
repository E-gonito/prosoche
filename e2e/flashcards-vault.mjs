/**
 * The Flashcards suite's own files, written by `flashcards.spec.ts` after
 * each reset rather than kept among `fixtures/`, so the other suites' vault
 * has no glossary but Work: two glossaries whose cards are on, and their
 * decks exactly as the glossary sync writes them.
 *
 * `Networks` has three terms in two categories, TCP reviewed before and
 * overdue by three days (a legacy `<!--SR:…-->` comment, rewritten as FSRS
 * state when graded), so it holds back one new card until it is graded.
 * `Tagalog` has twenty new words, more than the day's
 * fifteen, so the page has new cards waiting. A generated Anki `.txt` sits
 * beside Networks' cards, as the real vault's generator leaves them, and
 * nothing may touch it.
 */

/** `YYYY-MM-DD`, `offset` days from `from`. */
function day(from, offset) {
	const at = new Date(`${from}T00:00:00Z`);
	at.setUTCDate(at.getUTCDate() + offset);
	return at.toISOString().slice(0, 10);
}

const entry = (term, category, definition) => `## ${term}\n- status:: looked-up\n- category:: ${category}\n\n${definition}\n\n`;

const header = (glossary, category) =>
	`---\nglossary: ${glossary}\ncategory: ${category}\n---\n\n#flashcards\n\nMade from [[Glossaries/${glossary}|${glossary}]] (${category}). Edit the terms there; this file is\nkept in step with the glossary.\n`;

const WORDS = Array.from({ length: 20 }, (_, i) => [`Salita ${String(i + 1).padStart(2, '0')}`, `Word ${i + 1}`]);

export default function ({ TODAY }) {
	return {
		'Glossaries/Networks.md': `---\nflashcards: true\n---\n# Glossary\n\n${entry('TCP', 'Protocols', 'A reliable transport.')}${entry('UDP', 'Protocols', 'A datagram transport.')}${entry('DNS', 'Naming', 'Names to addresses.')}`,
		'Flashcards/Networks/Protocols (cards).md': `${header('Networks', 'Protocols')}\nTCP\n??\nA reliable transport.\n<!--SR:!${day(TODAY, -3)},4,270-->\n\nUDP\n??\nA datagram transport.\n`,
		'Flashcards/Networks/Naming (cards).md': `${header('Networks', 'Naming')}\nDNS\n??\nNames to addresses.\n`,
		'Flashcards/Networks/Old deck.txt': 'front\tback\n',

		'Glossaries/Tagalog.md': `---\nflashcards: true\n---\n# Glossary\n\n${WORDS.map(([term, meaning]) => entry(term, 'Words', meaning)).join('')}`,
		'Flashcards/Tagalog/Words (cards).md': `${header('Tagalog', 'Words')}${WORDS.map(([term, meaning]) => `\n${term}\n??\n${meaning}\n`).join('')}`
	};
}
