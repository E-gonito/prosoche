/**
 * Fixtures for the Study module: two goals with milestones, a session log
 * with one entry yesterday and one today, a due flashcard, and a resource
 * still queued to read.
 *
 * All under `Study/`, which is the `study` workspace's own folder in the base
 * vault (`_hub/workspaces/study.md`), so these land in the same scope the
 * base vault's `Study/Algorithms.md` and `Study/Syllabus.md` already occupy.
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
			`## ${month}`,
			`- ${day(TODAY, -1)} 30m [[Algorithms]] revised the reading`,
			`- ${TODAY} 1h30m [[Algorithms]] graph search, finally clicked`,
			''
		].join('\n'),

		// #flashcards, so the plugin — and the hub — count it; one card, overdue
		// by three days at interval 4 and ease 270, so it comes up first.
		'Study/Flashcards.md': [
			'#flashcards',
			'',
			'What does SM-2 schedule::The day a card is next due',
			`<!--SR:!${day(TODAY, -3)},4,270-->`,
			''
		].join('\n'),

		'Study/Resources/Video. Pointers explained.md': [
			'---',
			'media_link: https://example.com/watch?v=pointers',
			'---',
			'#Video',
			''
		].join('\n')
	};
}
