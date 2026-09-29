/**
 * Fixtures for the Study module: one subject, the base vault's `study`
 * workspace (`template: study`, home `Study/`), with two goals and their
 * milestones, a session log with one entry yesterday and one today (both on
 * a goal) and an older one on a pre-goal `[[Topic]]`, a reading list, and a
 * card file under a goal holding one due card.
 *
 * All under `Study/`, the subject's home, so these land in the same scope
 * the base vault's `Study/Algorithms.md` and `Study/Syllabus.md` already
 * occupy.
 */

/** `YYYY-MM-DD`, `offset` days from `from`. */
function day(from, offset) {
	const at = new Date(`${from}T00:00:00Z`);
	at.setUTCDate(at.getUTCDate() + offset);
	return at.toISOString().slice(0, 10);
}

export default function ({ TODAY }) {
	const month = TODAY.slice(0, 7);

	return {
		'Study/Goals.md': [
			'---',
			'weekly_hours: 6',
			'---',
			'## Pass AWS Solutions Architect',
			'target:: 2026-12-15',
			'- [x] Finish the networking module 📅 2026-10-05',
			'- [ ] Two practice exams 📅 2026-11-20',
			'',
			'## Read three papers a month',
			'- [ ] Paper one',
			'- [ ] Paper two',
			''
		].join('\n'),

		'Study/Sessions.md': [
			`## ${day(TODAY, -40).slice(0, 7)}`,
			`- ${day(TODAY, -40)} 20m [[Algorithms]] from before goals`,
			'',
			`## ${month}`,
			`- ${day(TODAY, -1)} 30m [[Goals#Pass AWS Solutions Architect]] revised the reading`,
			`- ${TODAY} 1h30m [[Goals#Pass AWS Solutions Architect]] graph search, finally clicked`,
			''
		].join('\n'),

		// The plugin's own format, as prosoche writes it: Done is **Complete**.
		'Study/Reading List.md': [
			'---',
			'',
			'kanban-plugin: board',
			'',
			'---',
			'',
			'## To read',
			'',
			'- [ ] [Pointers explained](https://example.com/watch?v=pointers) #video',
			'- [ ] The Pragmatic Programmer #book',
			'',
			'',
			'## Reading',
			'',
			'- [ ] [AWS whitepapers](https://aws.amazon.com/whitepapers) [[Goals#Pass AWS Solutions Architect]] #article',
			'',
			'',
			'## Paused',
			'',
			'',
			'',
			'## Done',
			'',
			'**Complete**',
			'',
			'',
			'',
			'',
			'%% kanban:settings',
			'```',
			'{"kanban-plugin":"board"}',
			'```',
			'%%'
		].join('\n'),

		// #flashcards, so the plugin — and the hub — count it; one card, overdue
		// by three days at interval 4 and ease 270, so it comes up first. Its
		// goal: puts it under the first goal.
		'Study/Flashcards.md': [
			'---',
			'goal: Pass AWS Solutions Architect',
			'---',
			'#flashcards',
			'',
			'What does SM-2 schedule::The day a card is next due',
			`<!--SR:!${day(TODAY, -3)},4,270-->`,
			''
		].join('\n')
	};
}
