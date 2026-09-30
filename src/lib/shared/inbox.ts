/**
 * One captured line of `Inbox/Capture.md`, as the triage page, a
 * workspace's Inbox tab and Today's Inbox card render it. Built by
 * `$server/inbox.ts`, which alone reads the file; plain data here, because a
 * page may not import the server.
 */

import type { Task } from './task';

export interface InboxLine {
	/** 0-based line in the file, and that line exactly: the conflict token. */
	line: number;
	raw: string;
	/** Present when the line is already a task. */
	task: Task | null;
	/** True once ticked, whichever way it was ticked. */
	done: boolean;
	/** The words, with the bullet and any checkbox stripped. */
	text: string;
	/** The `## YYYY-MM-DD` heading the line sits under, or null above the first one. */
	day: string | null;
}
