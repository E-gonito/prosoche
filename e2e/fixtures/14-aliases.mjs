/**
 * Fixtures for phase 1 of the workspaces plan: a workspace that names itself
 * in the words of a task rather than with a tag.
 *
 * The fixture's today note already plans "10:40 - 18:00 Client project" with
 * no `#ws/` anywhere on the line, which is the shape of the author's own days.
 * This workspace claims it by alias, so the attribution that needs no edit to
 * the note is exercised by the same note every other test reads.
 */

export default async function () {
	return {
		'_hub/workspaces/client.md': [
			'---',
			'name: Client',
			'color: "#b45309"',
			'tag: ws/client',
			'template: project',
			'folders:',
			'  - "Work/Client"',
			'aliases:',
			'  - "Client project"',
			'tabs:',
			'  - title: Board',
			'    widgets: [board]',
			'---',
			'',
			'Named in the daily note rather than tagged.',
			''
		].join('\n')
	};
}
