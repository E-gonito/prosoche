/**
 * What the Meetings pages and the server agree on.
 *
 * Data only, so a component can name these shapes without importing a
 * server module. The grammar that produces them is `$server/parse/meeting`
 * and `$server/parse/glossary`; nothing here knows how a line is written.
 */

import type { Task } from './task';

export const CAPTURE_KINDS = ['term', 'question', 'decision', 'action', 'note'] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

/** Labels for the capture selector and for grouping a past meeting. */
export const CAPTURE_LABELS: Record<CaptureKind, { one: string; many: string }> = {
	term: { one: 'Term', many: 'Terms' },
	question: { one: 'Question', many: 'Questions' },
	decision: { one: 'Decision', many: 'Decisions' },
	action: { one: 'Action', many: 'Actions' },
	note: { one: 'Note', many: 'Notes' }
};

/** One line under `## Captured`, as read back. */
export interface CapturedItem {
	kind: CaptureKind;
	/** The term, question, decision, action or note, without its marker. */
	text: string;
	/** A term's "my guess", or null. Always null for other kinds. */
	guess: string | null;
	/** For an action, whether its box is ticked; null for other kinds. */
	done: boolean | null;
	/** 0-based line in the note. */
	line: number;
}

export type MeetingType = 'meeting' | 'standup';

/** A meeting note, summarised for the notebook. */
export interface MeetingSummary {
	path: string;
	title: string;
	type: MeetingType;
	/** `YYYY-MM-DD`, or null when neither the file name nor the note says. */
	date: string | null;
	/** `HH:MM` as written, or null while the meeting runs. */
	ended: string | null;
	event: string | null;
	attendees: string[];
	captured: CapturedItem[];
}

/** An open task from a meeting note, with where it came from. */
export interface OpenAction {
	task: Task;
	/** The task's words without the `action::` marker. */
	text: string;
	source: { path: string; title: string; date: string | null };
}

/** A calendar event with its workspace, for the Meetings page. */
export interface EventRow {
	id: string;
	title: string;
	day: string;
	startMin: number | null;
	endMin: number | null;
	attendees: string[];
	location: string;
	link: string;
	/** The workspace this title is assigned to, or null. */
	workspace: string | null;
	/** A workspace whose alias appears in the title, offered but not applied. */
	suggestion: string | null;
}
