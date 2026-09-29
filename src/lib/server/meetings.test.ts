import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import {
	MEETING_MAP_PATH,
	assignTitle,
	captureItem,
	capturedTerms,
	currentMeeting,
	customPages,
	endMeeting,
	eventForNotebook,
	isMeetingNote,
	loadAssignments,
	loadMeetings,
	notebookPaths,
	openActions,
	pageTitle,
	planEvents,
	primerView,
	startMeeting,
	type NotebookPaths
} from './meetings';
import type { CalendarEvent } from './calendar';
import type { Workspace } from './workspaces';

const ws = (slug: string, over: Partial<Workspace> = {}): Workspace => ({
	slug,
	name: slug,
	color: '#000',
	tag: `ws/${slug}`,
	aliases: [],
	folders: [slug[0].toUpperCase() + slug.slice(1)],
	template: 'project',
	meetings: true,
	path: `_hub/workspaces/${slug}.md`,
	...over
});

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
	id: 'e1@google.com/2026-09-29',
	title: 'Dev Weekly Meeting',
	day: '2026-09-29',
	startMin: 600,
	endMin: 660,
	location: '',
	description: '',
	attendees: ['Ana'],
	link: '',
	...over
});

describe('notebookPaths', () => {
	it('puts everything under the first folder', () => {
		expect(notebookPaths(ws('work', { folders: ['Work/Eye2Gene/', 'Other'] }))).toEqual({
			home: 'Work/Eye2Gene',
			primer: 'Work/Eye2Gene/Primer.md',
			log: 'Work/Eye2Gene/Log.md',
			meetings: 'Work/Eye2Gene/Meetings'
		});
		expect(notebookPaths(ws('none', { folders: [] }))).toBeNull();
	});

	it('has no notebook for a workspace that has not opted in to meetings', () => {
		expect(notebookPaths(ws('quiet', { meetings: false }))).toBeNull();
		expect(notebookPaths(ws('quiet', { meetings: undefined }))).toBeNull();
	});

	it.each([
		['Work/Meetings/2026-09-29 Dev.md', true],
		['Work/Meetings/Sub/2026-09-29 Dev.md', false],
		['Work/Meetings/notes.txt', false],
		['Work/Primer.md', false],
		['Other/Meetings/x.md', false],
		['Work/Meetings/.md', false]
	])('isMeetingNote(%j) is %s', (path, expected) => {
		expect(isMeetingNote(notebookPaths(ws('work'))!, path)).toBe(expected);
	});
});

describe('planEvents', () => {
	const workspaces = [ws('work', { aliases: ['eye2gene'] }), ws('study')];

	it('groups by day with the assigned workspace', () => {
		const days = planEvents(
			[event({}), event({ id: 'e2', title: 'Lunch', startMin: 720 }), event({ id: 'e3', day: '2026-09-30', title: 'Reading group' })],
			[
				{ title: 'dev weekly meeting', slug: 'work', line: 0 },
				{ title: 'Reading group', slug: 'study', line: 1 }
			],
			workspaces
		);
		expect(days.map((d) => [d.day, d.events.map((e) => [e.title, e.workspace, e.suggestion])])).toEqual([
			['2026-09-29', [['Dev Weekly Meeting', 'work', null], ['Lunch', null, null]]],
			['2026-09-30', [['Reading group', 'study', null]]]
		]);
	});

	it('offers an alias match as a suggestion without assigning it', () => {
		const [day] = planEvents([event({ title: 'Eye2Gene sync' })], [], workspaces);
		expect(day.events[0]).toMatchObject({ workspace: null, suggestion: 'work' });
	});

	it('ignores a mapping to a workspace that is gone', () => {
		const [day] = planEvents([event({})], [{ title: 'Dev Weekly Meeting', slug: 'deleted', line: 0 }], workspaces);
		expect(day.events[0].workspace).toBeNull();
	});

	it('leaves out a workspace without meetings, as a mapping and as a suggestion', () => {
		const quiet = [ws('work', { aliases: ['eye2gene'], meetings: false })];
		const [day] = planEvents(
			[event({}), event({ id: 'e2', title: 'Eye2Gene sync' })],
			[{ title: 'Dev Weekly Meeting', slug: 'work', line: 0 }],
			quiet
		);
		expect(day.events.map((e) => [e.workspace, e.suggestion])).toEqual([
			[null, null],
			[null, null]
		]);
	});
});

describe('eventForNotebook', () => {
	const map = [{ title: 'Dev Weekly Meeting', slug: 'work', line: 0 }];
	const events = [
		event({ id: 'a', startMin: 540, endMin: 600 }),
		event({ id: 'b', startMin: 840, endMin: 900 }),
		event({ id: 'c', startMin: 720, endMin: 780 }),
		event({ id: 'other', title: 'Lunch', startMin: 610, endMin: 700 }),
		event({ id: 'allday', startMin: null, endMin: null }),
		event({ id: 'tomorrow', day: '2026-09-30', startMin: 500 })
	];

	it.each([
		[550, 'a'],
		[600, 'c'],
		[730, 'c'],
		[800, 'b'],
		[901, null]
	])('at minute %d picks %s', (now, id) => {
		expect(eventForNotebook(events, map, 'work', '2026-09-29', now)?.id ?? null).toBe(id);
	});

	it('picks nothing for a workspace with no events', () => {
		expect(eventForNotebook(events, map, 'study', '2026-09-29', 550)).toBeNull();
	});
});

describe('primerView', () => {
	const PRIMER = `---
updated: 2026-09-01
---
# Eye2Gene primer

**Your job in the room is not to know ophthalmology.** It is to convert.

> **Rate limit:** two or three interventions.

## Your product

From the paper.

- Three input modalities.
  - Colour fundus is absent.

> An aside in the middle.

More text.

## Empty

\`\`\`
## not a heading
> not a callout
\`\`\`
`;

	it('splits into a lead and ## sections, with callouts apart', () => {
		const view = primerView(PRIMER);
		expect(view.map((s) => [s.heading, s.blocks.map((b) => b.kind)])).toEqual([
			[null, ['text', 'callout']],
			['Your product', ['text', 'callout', 'text']],
			['Empty', ['text']]
		]);
		expect(view[0].blocks[0].html).toContain('<strong>Your job in the room');
		expect(view[0].blocks[0].html).not.toContain('Eye2Gene primer');
		expect(view[0].blocks[1].html).toContain('<strong>Rate limit:</strong>');
		expect(view[0].blocks[1].html).not.toContain('blockquote');
		expect(view[1].blocks[0].html).toContain('<li>');
		expect(view[2].blocks[0].html).toContain('## not a heading');
		expect(view[2].blocks[0].html).toContain('&gt; not a callout');
	});

	it('keeps a # heading that is not the first thing', () => {
		const view = primerView('Intro.\n\n# Later\n');
		expect(view[0].blocks[0].html).toContain('<h1');
	});

	it('is empty for an empty note', () => {
		expect(primerView('')).toEqual([]);
	});

	it('resolves wikilinks', () => {
		const view = primerView('See [[Log]].', (t) => (t === 'Log' ? '/notes/Work/Log.md' : null));
		expect(view[0].blocks[0].html).toContain('href="/notes/Work/Log.md"');
	});
});

describe('pageTitle', () => {
	it.each([
		['eye-3d.html', 'Eye 3d'],
		['Eye (3D).html', 'Eye (3D)'],
		['.html', '.html']
	])('%j', (file, title) => {
		expect(pageTitle(file)).toBe(title);
	});
});

describe('the notebook on disk', () => {
	let dir: string;
	let vault: Vault;
	let paths: NotebookPaths;
	const work = ws('work');

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'meetings-'));
		vault = new Vault(dir);
		paths = notebookPaths(work)!;
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const PAST = `---
type: meeting
date: 2026-09-28
---
# Dev Weekly

## Captured
- term:: Cookie Cutter guess:: something for AI models
- [ ] action:: Clarify scope
- [x] action:: Done
- decision:: Use ECS
`;

	it('starts, captures into and ends a meeting', async () => {
		const started = await startMeeting(vault, paths, { type: 'meeting', title: 'Dev Weekly', date: '2026-09-29', attendees: ['Ana'] });
		expect(started).toEqual({ ok: true, path: 'Work/Meetings/2026-09-29 Dev Weekly.md' });
		const path = 'Work/Meetings/2026-09-29 Dev Weekly.md';

		expect(await captureItem(vault, work, path, { kind: 'term', text: 'DVC', guess: 'data versioning' })).toEqual({ ok: true, path });
		await captureItem(vault, work, path, { kind: 'action', text: 'Ask Ben' });
		expect((await vault.read(path)).content).toBe(
			'---\ntype: meeting\ndate: 2026-09-29\nattendees: [Ana]\n---\n# Dev Weekly\n\n## Captured\n- term:: DVC guess:: data versioning\n- [ ] action:: Ask Ben\n'
		);
		// The term went into the glossary too, and nothing else did.
		expect((await vault.read('Work/Glossary.md')).content).toBe(
			'# Glossary\n\n## DVC\n- guess:: data versioning\n- status:: to-look-up\n- source:: [[2026-09-29 Dev Weekly]]\n'
		);

		const meetings = await loadMeetings(vault, paths);
		expect(currentMeeting(meetings, '2026-09-29')?.path).toBe(path);

		await endMeeting(vault, paths, path, '11:05');
		expect((await vault.read(path)).content).toContain('attendees: [Ana]\nended: 11:05\n---\n');
		expect(currentMeeting(await loadMeetings(vault, paths), '2026-09-29')).toBeNull();
	});

	it('never overwrites a meeting with the same name', async () => {
		await startMeeting(vault, paths, { type: 'standup', title: 'Standup', date: '2026-09-29' });
		const second = await startMeeting(vault, paths, { type: 'standup', title: 'Standup', date: '2026-09-29' });
		expect(second).toEqual({ ok: true, path: 'Work/Meetings/2026-09-29 Standup 2.md' });
	});

	it('refuses to capture into a note outside the Meetings folder', async () => {
		await vault.write('Work/Handbook.md', '# H\n');
		expect(await captureItem(vault, work, 'Work/Handbook.md', { kind: 'note', text: 'x' })).toMatchObject({ ok: false, reason: 'invalid' });
		expect(await captureItem(vault, work, 'Work/Meetings/2026-01-01 Gone.md', { kind: 'note', text: 'x' })).toMatchObject({
			ok: false,
			reason: 'not-found'
		});
		expect(await endMeeting(vault, paths, 'Work/Handbook.md', '10:00')).toMatchObject({ ok: false, reason: 'invalid' });
		expect((await vault.read('Work/Handbook.md')).content).toBe('# H\n');
	});

	it('lists open actions newest meeting first, with their source', async () => {
		await vault.write('Work/Meetings/2026-09-28 Dev Weekly.md', PAST);
		await vault.write('Work/Meetings/2026-09-29 Standup.md', '# Standup\n\n## Captured\n- [ ] action:: Newer\n');
		const actions = openActions(await loadMeetings(vault, paths));
		expect(actions.map((a) => [a.text, a.source.title, a.source.date, a.task.line])).toEqual([
			['Newer', 'Standup', '2026-09-29', 3],
			['Clarify scope', 'Dev Weekly', '2026-09-28', 8]
		]);
		expect(actions[1].task.raw).toBe('- [ ] action:: Clarify scope');
	});

	it('keeps a captured term that is already in the glossary out of it, and still captures it', async () => {
		const glossary = '# Glossary\n\n## DVC\n- status:: looked-up\n';
		await vault.write('Work/Glossary.md', glossary);
		const path = 'Work/Meetings/2026-09-29 Dev Weekly.md';
		await startMeeting(vault, paths, { type: 'meeting', title: 'Dev Weekly', date: '2026-09-29' });
		expect(await captureItem(vault, work, path, { kind: 'term', text: 'dvc' })).toEqual({ ok: true, path });
		expect((await vault.read(path)).content).toContain('- term:: dvc\n');
		expect((await vault.read('Work/Glossary.md')).content).toBe(glossary);
	});

	it('refuses to capture for a workspace without meetings', async () => {
		const quiet = { ...work, meetings: false };
		expect(await captureItem(vault, quiet, 'Work/Meetings/2026-09-29 X.md', { kind: 'term', text: 'DVC' })).toMatchObject({
			ok: false,
			reason: 'not-found'
		});
		expect((await vault.read('Work/Glossary.md')).exists).toBe(false);
	});

	it('lists every captured term, newest meeting first, with its source', async () => {
		await vault.write('Work/Meetings/2026-09-28 Dev Weekly.md', PAST.replace('- decision', '- term:: DVC\n- decision'));
		await vault.write('Work/Meetings/2026-09-29 Standup.md', '# Standup\n\n## Captured\n- term:: DVC guess:: again\n');
		expect((await capturedTerms(vault, work)).map((t) => [t.term, t.guess, t.source, t.meeting.date])).toEqual([
			['DVC', 'again', '[[2026-09-29 Standup]]', '2026-09-29'],
			['Cookie Cutter', 'something for AI models', '[[2026-09-28 Dev Weekly]]', '2026-09-28'],
			['DVC', null, '[[2026-09-28 Dev Weekly]]', '2026-09-28']
		]);
		expect(await capturedTerms(vault, { ...work, meetings: false })).toEqual([]);
	});

	it('remembers an event title, rewriting only its line on a change', async () => {
		const workspaces = [work, ws('study')];
		expect(await assignTitle(vault, workspaces, 'Dev Weekly', 'work')).toEqual({ ok: true, path: MEETING_MAP_PATH });
		await assignTitle(vault, workspaces, 'Reading group', 'study');
		const before = (await vault.read(MEETING_MAP_PATH)).content;
		await assignTitle(vault, workspaces, 'dev weekly', 'study');
		const after = (await vault.read(MEETING_MAP_PATH)).content;
		expect(after).toBe(before.replace('- Dev Weekly → work', '- Dev Weekly → study'));
		expect((await loadAssignments(vault)).map((m) => [m.title, m.slug])).toEqual([
			['Dev Weekly', 'study'],
			['Reading group', 'study']
		]);
		expect(await assignTitle(vault, workspaces, 'X', 'nope')).toMatchObject({ ok: false, reason: 'invalid' });
		expect(await assignTitle(vault, [ws('quiet', { meetings: false })], 'X', 'quiet')).toMatchObject({ ok: false, reason: 'invalid' });
	});

	it('lists the workspace\'s custom pages as tabs served by Workspaces', async () => {
		expect(await customPages(vault, work)).toEqual([]);
		await vault.write(`${work.folders[0]}/Pages/eye-3d.html`, '<p>eye</p>');
		expect(await customPages(vault, work)).toEqual([
			{ file: 'eye-3d.html', title: 'Eye 3d', href: `/w/${work.slug}/pages/eye-3d.html` }
		]);
		// Pages belong to the workspace, not its notebook, so they do not wait on meetings.
		expect(await customPages(vault, { ...work, meetings: false })).toHaveLength(1);
	});
});
