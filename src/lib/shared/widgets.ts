/**
 * What a widget is, known to both sides.
 *
 * The catalogue is split in two on purpose: this half is metadata a browser
 * may see, and `$server/widgets` holds the loaders that read the vault. A
 * component that needed the server half would drag the filesystem into the
 * bundle.
 */

export interface WidgetMeta {
	title: string;
	/** Grid columns the widget wants: 1 is a card, 2 is full width. */
	span: 1 | 2;
	/** One line for the workspace editor, so a name is never a mystery. */
	description: string;
}

export interface LoadedWidget {
	name: string;
	title: string;
	span: 1 | 2;
	data: unknown;
	/** Set when the widget could not load, in place of data. */
	problem?: string;
}

export const WIDGETS: Record<string, WidgetMeta> = {
	board: { title: 'Board', span: 2, description: 'Kanban of the workspace’s tasks, by status.' },
	notes: { title: 'Notes', span: 2, description: 'The workspace’s notes, most recently changed first.' },
	blocked: { title: 'Blocked', span: 1, description: 'Tasks waiting on another task, and what unblocks them.' },
	pinned: { title: 'Pinned', span: 1, description: 'Anything tagged #pin, wherever it lives.' },
	inbox: { title: 'Inbox', span: 1, description: 'Unfiled captures waiting to be sorted.' },
	people: { title: 'People', span: 2, description: 'People linked from this workspace, and follow-ups due.' },
	time: { title: 'Time', span: 1, description: 'Planned against actual time, this week.' },
	insights: { title: 'Insights', span: 2, description: 'Ask questions scoped to this workspace.' },
	habits: { title: 'Habits', span: 1, description: 'Recurring tasks and how the streak is going.' },
	'currently-learning': { title: 'Currently learning', span: 1, description: 'Resources in progress.' },
	queue: { title: 'Queue', span: 1, description: 'What to read or watch next.' },
	'topic-map': { title: 'Topic map', span: 2, description: 'Topics covered, and the gaps.' },
	'flashcards-due': { title: 'Flashcards due', span: 1, description: 'Cards scheduled for review today.' },
	timesheet: { title: 'Timesheet', span: 2, description: 'Today’s timesheet section, read only.' },
	github: { title: 'GitHub', span: 1, description: 'Open issues and pull requests.' },
	linear: { title: 'Linear', span: 1, description: 'Assigned Linear issues.' }
};
