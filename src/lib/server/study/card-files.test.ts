import { describe, expect, it } from 'vitest';
import { cardFilePath } from './card-files';
import type { Subject } from './subjects';

const CS: Subject = {
	slug: 'cs',
	name: 'Computer Science',
	color: '#000',
	home: 'Study/CS',
	scope: { folders: ['Study/CS', 'Computer Science'], tags: ['ws/cs'] },
	newPerDay: 20,
	path: '_hub/subjects/cs.md',
	files: {
		goals: 'Study/CS/Goals.md',
		reading: 'Study/CS/Reading List.md',
		sessions: 'Study/CS/Sessions.md',
		flashcards: 'Study/CS/Flashcards'
	}
};

describe('cardFilePath', () => {
	it.each([
		[null, 'Study/CS/Flashcards/From notes.md'],
		['Networking', 'Study/CS/Flashcards/Networking.md'],
		['Pass AWS: Solutions Architect', 'Study/CS/Flashcards/Pass AWS Solutions Architect.md'],
		['C/C++ [systems] #1', 'Study/CS/Flashcards/C C++ systems 1.md'],
		['../../etc', 'Study/CS/Flashcards/etc.md'],
		['///', 'Study/CS/Flashcards/From notes.md']
	])('files cards under %s in %s', (goal, path) => {
		expect(cardFilePath(CS, goal)).toBe(path);
	});
});
