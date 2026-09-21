/**
 * Fixtures for phase 5: flashcards, resources and a curriculum.
 *
 * Shaped like the real vault rather than like the specification, because the
 * two disagree. Cards are Spaced Repetition markdown with the plugin's own
 * `<!--SR:!date,interval,ease-->` comments; resources are notes whose only
 * frontmatter is a link, with a `#Video` tag and no status at all; and the
 * curriculum is a note of headings over checkboxes, which is how this user
 * writes one. There is also a note holding cards with no `#flashcards` tag,
 * so the "Obsidian cannot see these" warning has something to warn about.
 *
 * The `reading` workspace exists so the study widgets can be proved to work
 * somewhere that is not the study page, which is the point of them.
 */

const day = (from, offset) => {
	const at = new Date(`${from}T00:00:00Z`);
	at.setUTCDate(at.getUTCDate() + offset);
	return at.toISOString().slice(0, 10);
};

export default async function ({ TODAY }) {
	return {
		'Study/Flashcards.md': [
			'# Scheduling',
			'',
			'#flashcards',
			'',
			'## Algorithms',
			'',
			'What does SM-2 schedule::The day a card is next due',
			`<!--SR:!${day(TODAY, -3)},4,270-->`,
			'',
			'Which plugin owns the comment format::Obsidian Spaced Repetition',
			'',
			'What is never due yet::A card scheduled years out',
			'<!--SR:!2099-01-01,400,250-->',
			'',
			'## Memory',
			'',
			'Name the two ends of the address space',
			'?',
			'The stack at the top and the heap at the bottom.',
			''
		].join('\n'),

		// No `#flashcards` tag, so Obsidian would never review these. The hub
		// counts them and says so rather than reviewing them behind its back.
		'Study/Loose cards.md': ['# Loose', '', 'What is a loose card::One no plugin can see', ''].join('\n'),

		'Study/Curriculum.md': [
			'#### 1. Foundations',
			'',
			'- [x] Binary and hexadecimal',
			'- [ ] Two’s complement',
			'- [ ] Floating point',
			'',
			'#### 2. Systems',
			'',
			'- [ ] Virtual memory',
			'- [ ] Caches',
			''
		].join('\n'),

		'Study/Resources/Video. Pointers explained.md': [
			'---',
			'media_link: https://example.com/watch?v=pointers',
			'---',
			'#Video',
			''
		].join('\n'),

		'Study/Resources/Book. The C Programming Language.md': [
			'---',
			'media_link: https://example.com/book/k-and-r',
			'---',
			'#Book',
			'',
			'Chapter one is a whole language in twenty pages. The tutorial builds up from',
			'hello world to a word count program, and every exercise is worth doing twice.',
			'Notes here are mine, written while reading, which is what tells the hub this',
			'is something already under way rather than something still queued up.',
			''
		].join('\n'),

		'Reading/Cards.md': [
			'# Reading cards',
			'',
			'#flashcards',
			'',
			'Who wrote A Philosophy of Software Design::John Ousterhout',
			`<!--SR:!${day(TODAY, -1)},2,250-->`,
			''
		].join('\n'),

		'Reading/Video. How to read a book.md': [
			'---',
			'media_link: https://example.com/watch?v=reading',
			'---',
			'#Video',
			''
		].join('\n'),

		'_hub/workspaces/reading.md': [
			'---',
			'name: Reading',
			'color: "#16a34a"',
			'tag: ws/reading',
			'template: area',
			'folders:',
			'  - "Reading"',
			'tabs:',
			'  - title: Dashboard',
			'    widgets: [currently-learning, queue, flashcards-due, topic-map, habits]',
			'---',
			'',
			'Proves the study widgets work outside the study page.',
			''
		].join('\n')
	};
}
