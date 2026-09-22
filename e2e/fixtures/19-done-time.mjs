/**
 * Fixtures for phase 2: a workspace whose week is ticked rather than timed.
 *
 * The fixture's today note already contains `- [x] 09:30 - 10:00 Morning
 * stretch`, a timed block that was ticked and never timed, with no `#ws/`
 * anywhere on the line. This workspace claims it by alias, so the Time widget
 * has a week of exactly the shape the author's own days have: half an hour
 * planned, half an hour done, the timer never touched.
 *
 * Its only tab is Time, so the page under test is the widget itself, and it
 * owns a folder nothing else uses so it can claim nothing by accident. Errands
 * is the same workspace with nothing to show, which is what the widget's empty
 * state is for.
 */

export default async function () {
	return {
		'_hub/workspaces/wellbeing.md': [
			'---',
			'name: Wellbeing',
			'color: "#16a34a"',
			'tag: ws/wellbeing',
			'template: project',
			'folders:',
			'  - "Wellbeing"',
			'aliases:',
			'  - "Morning stretch"',
			'tabs:',
			'  - title: Time',
			'    widgets: [time]',
			'---',
			'',
			'Ticked every morning, never timed.',
			''
		].join('\n'),

		'_hub/workspaces/errands.md': [
			'---',
			'name: Errands',
			'color: "#b45309"',
			'tag: ws/errands',
			'template: project',
			'folders:',
			'  - "Errands"',
			'tabs:',
			'  - title: Time',
			'    widgets: [time]',
			'---',
			'',
			'Nothing planned, nothing ticked, nothing timed.',
			''
		].join('\n')
	};
}
