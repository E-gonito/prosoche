/**
 * The one read every `/study/*` page starts from: which workspace study is
 * scoped to, and what each of its notes currently holds.
 *
 * Every study route needs the same scope and home folder, and the tab bar on
 * every one of them needs to know whether the *other* tabs have anything to
 * show. Rather than each page re-deriving the scope and reading a subset of
 * the notes, there is one function that reads all of it, and one that turns
 * that into the tab bar. The extra reads this costs a page that only needs
 * one of the four are cheap: `resources` and `topicsIn` share one cached
 * sweep of the vault per process, and `Goals.md`/`Sessions.md` are two more
 * small files, invalidated only when something in the vault actually changes.
 */

import { dueCards, type CardQueue } from './flashcards';
import { parseGoals, type GoalsNote } from './goals';
import { resources as loadResources } from './resources';
import { readSessions, type Session } from './sessions';
import { studyContext, studyPath } from './topics';
import type { Resource, StudyScope, StudyTab } from '$lib/shared/study';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';
import type { Workspace } from '../workspaces';

export interface StudySummary {
	scope: StudyScope;
	/** The first folder the scope names, or '' at the vault root. */
	home: string;
	goalsPath: string;
	sessionsPath: string;
	goals: GoalsNote;
	sessions: Session[];
	resources: Resource[];
	cards: CardQueue;
}

/** Everything a `/study/*` page load needs, read once. Never writes. */
export async function studySummary(
	vault: Vault,
	index: NoteIndex,
	workspaces: () => Promise<Workspace[]>,
	today: string
): Promise<StudySummary> {
	const { scope, home } = await studyContext(workspaces);
	const goalsPath = studyPath(home, 'Goals.md');
	const sessionsPath = studyPath(home, 'Sessions.md');

	const [goalsNote, sessions, resources, cards] = await Promise.all([
		vault.read(goalsPath).then((note) => parseGoals(note.content, goalsPath)),
		readSessions(vault, sessionsPath),
		loadResources(vault, index, scope),
		dueCards(vault, index, { on: today, scope })
	]);

	return { scope, home, goalsPath, sessionsPath, goals: goalsNote, sessions, resources, cards };
}

export type { StudyTab };

/** The study section's tab bar, from a summary already read. Pure. */
export function studyTabs(summary: StudySummary): StudyTab[] {
	return [
		{ title: 'Overview', href: '/study', visible: true },
		{ title: 'Goals', href: '/study/goals', visible: summary.goals.goals.length > 0 },
		{ title: 'Sessions', href: '/study/sessions', visible: summary.sessions.length > 0 },
		{ title: 'Flashcards', href: '/study/review', visible: summary.cards.total > 0 },
		{ title: 'Reading list', href: '/study/resources', visible: summary.resources.length > 0 }
	];
}
