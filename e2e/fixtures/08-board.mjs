/**
 * Fixtures for phase 2: a workspace with a real board.
 *
 * Shaped like the vault this app is written for, not like a demo. The deck
 * holds cards with quadrants, a dependency pair and a card parked in a named
 * column; the test plan holds checkbox lines that are notation rather than
 * work, which is what the board has to leave out and offer to promote; and a
 * task in another workspace waits on a card in this one, which is the
 * cross-workspace case SPEC 5.5 asks for.
 */

export default async function ({ TODAY }) {
	return {
		'_hub/workspaces/atlas.md': [
			'---',
			'name: Atlas',
			'color: "#0891b2"',
			'tag: ws/atlas',
			'template: project',
			'folders:',
			'  - "Work/Atlas"',
			'deck: "Work/Atlas/Tasks.md"',
			'kanban_columns: [To do, In progress, Review, Done]',
			'tabs:',
			'  - title: Board',
			'    widgets: [board]',
			'  - title: Notes',
			'    widgets: [notes, inbox]',
			'  - title: Blocked',
			'    widgets: [blocked, pinned]',
			'---',
			'',
			'The day job.',
			''
		].join('\n'),

		'Work/Atlas/Tasks.md': [
			'# Atlas tasks',
			'',
			`- [ ] Draft the anonymisation plan \`Q2\` 📅 ${TODAY} 🆔 dcm1`,
			'- [/] Take ownership of the grading pipeline `Q1`',
			'- [ ] Ship the release `Q3` ⛔ dcm1',
			'- [x] Renew the certificate `Q4`',
			'- [ ] Sitting with the reviewer `Q2` #col/review',
			'- [ ] weekly sync agenda',
			''
		].join('\n'),

		// Checklist notation, the shape most `- [ ]` lines in this vault have.
		'Work/Atlas/Test plan.md': [
			'# Test plan',
			'',
			'- [ ] **Upload:** an upload with no title',
			'- [ ] **Upload:** a folder of mixed studies',
			'- [ ] **Report:** the PDF renders on a phone',
			''
		].join('\n'),

		'Work/Atlas/Meeting notes.md': [
			'# Meeting notes',
			'',
			'Talked to [[Handbook]] about anonymisation.',
			'',
			'- [ ] Send the anonymisation plan #ws/atlas `Q2`',
			'- [ ] Chase the sample files #ws/atlas `Q1` #pin',
			''
		].join('\n'),

		// Another workspace's card, waiting on one of Atlas's.
		'Study/Dependencies.md': ['# Dependencies', '', '- [ ] Read the pipeline docs `Q2` ⛔ dcm1', ''].join('\n'),

		'Inbox/Idea.md': ['# Idea', '', 'A cheaper way to store the study index.', ''].join('\n')
	};
}
