/**
 * A day built entirely out of the cases that broke the timeline's rendering.
 *
 * Its own date rather than today's note, because the shared fixture is what
 * most of the suite asserts against and this one exists to be awkward: four
 * consecutive ten-minute blocks, a twenty-minute block on the boundary
 * between the one-line and two-line layouts, a task name far too long for
 * any block to hold, and two blocks that genuinely overlap so the column
 * layout is exercised at the same time.
 */

export default async function () {
	return {
		'Journal/2026/11/03.md': [
			'# Day planner',
			'',
			'- [ ] 09:00 - 09:10 Ten minutes flat `Q1`',
			'- [ ] 09:10 - 09:20 Another ten, right after it `Q1`',
			'- [ ] 09:20 - 09:30 And a third `Q2`',
			'- [ ] 09:30 - 09:40 A fourth, to be sure `Q3`',
			'- [ ] 10:00 - 10:20 Twenty minutes, on the boundary `Q1`',
			'- [ ] 11:00 - 11:30 ' +
				'A task with a name so long that no block on any timeline could ever hope to ' +
				'show all of it, which is the whole point of writing it out at this length `Q2`',
			'- [ ] 13:00 - 17:00 A long containing block',
			'- [ ] 14:00 - 14:30 One nested inside it `Q1`',
			''
		].join('\n')
	};
}
