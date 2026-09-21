import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { NoteIndex } from '../index/index';
import { coverage, folderTopics, inScope, slug, syllabusTopics, topicsIn } from './topics';
import type { Card, Resource, Topic } from '$lib/shared/study';
import type { Task } from '$lib/shared/task';

describe('folderTopics', () => {
	it('turns a folder tree into parents and children', () => {
		const out = folderTopics(['CS/Networking/HTTP.md', 'CS/Networking/DNS.md', 'CS/Rust.md']);
		expect(out.map((t) => [t.id, t.parent, t.notes])).toEqual([
			['cs', null, 3],
			['cs/networking', 'cs', 2]
		]);
	});

	it('counts notes filed deeper than the topic itself', () => {
		const out = folderTopics(['CS/A/B/note.md']);
		expect(out.find((t) => t.id === 'cs')?.notes).toBe(1);
	});

	it('stops before a folder tree becomes a file tree', () => {
		// Four levels deep is filing, not a subject.
		const out = folderTopics(['CS/Courses/IBM/Resources/Video. Thing.md']);
		expect(out.map((t) => t.id)).toEqual(['cs', 'cs/courses', 'cs/courses/ibm']);
	});

	it('ignores a note sitting at the top of the vault', () => {
		expect(folderTopics(['README.md'])).toEqual([]);
	});
});

describe('syllabusTopics', () => {
	// The shape of `CS/Course/Course Syllabus.md`: `####` headings over
	// checkboxes, which is how this user writes a curriculum.
	const headings = [
		{ level: 4, text: '1. Networking', line: 0 },
		{ level: 4, text: '2. Tooling', line: 4 }
	];
	const task = (line: number, done: boolean): Task => ({
		path: 'CS/IT/Course Syllabus.md',
		line,
		blockEnd: line,
		status: done ? 'done' : 'todo',
		startMin: null,
		endMin: null,
		text: `item ${line}`,
		quadrant: null,
		fenced: false,
		raw: '',
		tags: [],
		id: null,
		blockedBy: [],
		due: null
	});
	const tasks = [task(1, true), task(2, false), task(3, false), task(5, true), task(6, true)];

	it('makes the note a topic and each heading a child of it', () => {
		const out = syllabusTopics('CS/IT/Course Syllabus.md', 'Course Syllabus', headings, tasks);
		expect(out.map((t) => [t.id, t.parent, t.done, t.total])).toEqual([
			['cs/it/course-syllabus', 'cs/it', 3, 5],
			['cs/it/course-syllabus/1-networking', 'cs/it/course-syllabus', 1, 3],
			['cs/it/course-syllabus/2-tooling', 'cs/it/course-syllabus', 2, 2]
		]);
	});

	it('leaves a note with a short to-do list out of the curriculum', () => {
		expect(syllabusTopics('CS/Notes.md', 'Notes', headings, tasks.slice(0, 3))).toEqual([]);
	});

	it('drops a heading that carries no checkboxes', () => {
		const withEmpty = [...headings, { level: 4, text: '3. Empty', line: 9 }];
		const out = syllabusTopics('CS/IT/Course Syllabus.md', 'Course Syllabus', withEmpty, tasks);
		expect(out.some((t) => t.name === '3. Empty')).toBe(false);
	});
});

describe('coverage', () => {
	const topic = (over: Partial<Topic>): Topic => ({
		id: 'cs',
		name: 'CS',
		parent: null,
		path: 'CS',
		kind: 'folder',
		notes: 1,
		done: 0,
		total: 0,
		...over
	});
	const resource = (path: string, over: Partial<Resource> = {}): Resource =>
		({ path, title: path, kind: 'video', url: null, status: 'queued', stated: false, progress: 0, topics: [], added: null, updatedMs: 0, tasksDone: 0, tasksTotal: 0, ...over }) as Resource;
	const card = (path: string, due: string | null): Card =>
		({ path, line: 0, endLine: 0, kind: 'inline', question: 'q', answer: 'a', context: '', deck: 'd', schedule: due ? { due, interval: 1, ease: 250 } : null, index: 0, siblings: 1, scheduleLine: 0, scheduleExists: false, expectedRaw: '' }) as Card;

	it('calls a topic with resources and cards covered', () => {
		const [out] = coverage([topic({})], [resource('CS/a.md')], [card('CS/b.md', '2026-09-21')]);
		expect(out).toMatchObject({ state: 'covered', resources: 1, cards: 1 });
	});

	it('calls a topic with only one of the two started', () => {
		expect(coverage([topic({})], [resource('CS/a.md')], [])[0].state).toBe('started');
		expect(coverage([topic({})], [], [card('CS/b.md', null)])[0].state).toBe('started');
	});

	it('calls a topic with nothing pointing at it a gap, which is the point', () => {
		expect(coverage([topic({})], [resource('Art/a.md')], [card('Art/b.md', null)])[0].state).toBe('gap');
	});

	it('counts a syllabus heading with ticked boxes as started, with no resources at all', () => {
		const heading = topic({ id: 'cs/syllabus/net', path: 'CS/Syllabus.md', kind: 'heading', done: 2, total: 5 });
		expect(coverage([heading], [], [])[0].state).toBe('started');
	});

	it('rolls a child’s coverage up to its parent folder', () => {
		const parent = topic({ id: 'cs', path: 'CS' });
		const child = topic({ id: 'cs/net', path: 'CS/Networking', parent: 'cs' });
		const out = coverage([parent, child], [resource('CS/Networking/a.md')], [card('CS/Networking/b.md', null)]);
		expect(out.map((t) => t.state)).toEqual(['covered', 'covered']);
	});

	it('matches a resource that names the topic even from another folder', () => {
		const out = coverage([topic({ id: 'operating-systems', path: 'CS/OS' })], [resource('Inbox/x.md', { topics: ['operating-systems'] })], []);
		expect(out[0].resources).toBe(1);
	});

	it('counts what is due only when asked for a day', () => {
		const cards = [card('CS/a.md', '2026-09-01'), card('CS/b.md', '2027-01-01')];
		expect(coverage([topic({})], [], cards, '2026-09-21')[0].cardsDue).toBe(1);
		expect(coverage([topic({})], [], cards)[0].cardsDue).toBe(0);
	});
});

describe('inScope', () => {
	it('lets everything through when nothing is named', () => {
		expect(inScope('anywhere/x.md', [], undefined)).toBe(true);
		expect(inScope('anywhere/x.md', [], {})).toBe(true);
	});

	it('matches a folder but not a folder that merely starts the same way', () => {
		expect(inScope('CS/x.md', [], { folders: ['CS'] })).toBe(true);
		expect(inScope('CSS/x.md', [], { folders: ['CS'] })).toBe(false);
	});

	it('matches a tag on the note, including a nested one', () => {
		expect(inScope('Anywhere/x.md', ['ws/personal/reading'], { tags: ['ws/personal'] })).toBe(true);
		expect(inScope('Anywhere/x.md', ['ws/work'], { tags: ['ws/personal'] })).toBe(false);
	});
});

describe('slug', () => {
	it('keeps the folder separators that make an id readable', () => {
		expect(slug('Computer Science/Data Structures')).toBe('computer-science/data-structures');
		expect(slug('1. The "London MSP" Stack')).toBe('1-the-london-msp-stack');
	});
});

describe('topicsIn', () => {
	let root: string;
	let vault: Vault;
	let index: NoteIndex;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-topics-'));
		vault = new Vault(root);
		index = new NoteIndex(':memory:');
		await vault.write('CS/Networking/HTTP.md', '# HTTP\n\nNotes.\n');
		await vault.write('CS/IT/Course Syllabus.md', '#### 1. Networking\n\n- [x] DNS\n- [ ] DHCP\n\n#### 2. Tooling\n\n- [ ] RMM\n- [ ] PSA\n');
		await vault.write('CS/Memory.md', '---\ntype: topic\nparent: CS\n---\n\n# Memory\n');
		await vault.write('CS/Orphan.md', '---\ntype: topic\nparent: Nowhere At All\n---\n\n# Orphan\n');
		await vault.write('Art/Sketching.md', '# Sketching\n');
		for (const path of await vault.list()) {
			const note = await vault.read(path);
			index.put(path, note.content, note.mtimeMs, note.hash);
		}
	});
	afterEach(async () => {
		index.close();
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('builds folders, syllabus headings and declared topics together', async () => {
		const out = await topicsIn(vault, index, { folders: ['CS'] });
		expect(out.filter((t) => t.kind === 'folder').map((t) => t.id)).toEqual(['cs', 'cs/it', 'cs/networking']);
		expect(out.find((t) => t.id === 'memory')).toMatchObject({ kind: 'declared', parent: 'cs' });
		expect(out.filter((t) => t.kind === 'heading').map((t) => t.name)).toEqual([
			'Course Syllabus',
			'1. Networking',
			'2. Tooling'
		]);
	});

	it('hangs a topic naming a parent that is not there off the root, rather than losing it', async () => {
		const out = await topicsIn(vault, index, { folders: ['CS'] });
		expect(out.find((t) => t.id === 'orphan')).toMatchObject({ parent: null });
	});

	it('reads the progress of a syllabus heading out of its checkboxes', async () => {
		const out = await topicsIn(vault, index, { folders: ['CS'] });
		expect(out.find((t) => t.name === '1. Networking')).toMatchObject({ done: 1, total: 2 });
	});

	it('stays inside its scope, so a workspace tab shows only its own subjects', async () => {
		const out = await topicsIn(vault, index, { folders: ['Art'] });
		expect(out.map((t) => t.id)).toEqual(['art']);
	});
});
