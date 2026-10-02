/**
 * Fixtures for the Study module: one subject, the base vault's `study`
 * subject (`_hub/subjects/study.md`, home `Study/`), with two goals and their
 * milestones, and a reading list.
 *
 * All under `Study/`, the subject's home, so these land in the same scope
 * the base vault's `Study/Algorithms.md` and `Study/Syllabus.md` already
 * occupy.
 */

export default function () {
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
		].join('\n')
	};
}
