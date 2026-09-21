import { OPEN_STATUSES } from '../../shared/task';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { NoteIndex, ftsQuery } from './index';

let index: NoteIndex;
beforeEach(() => {
	index = new NoteIndex(':memory:');
});
afterEach(() => index.close());

const DAILY = [
	'# [[Journal 2026]]',
	'# Tasks',
	'- [x] 09:30 - 10:00 Morning stretch `Q1`',
	'- [ ] Walk the dog `Q1`',
	'## Backlog',
	'```',
	'- [ ] Driving licence `Q2`',
	'```'
].join('\n');

describe('put and tasksIn', () => {
	it('indexes tasks with their times in minutes', () => {
		index.put('Journal/2026/09/21.md', DAILY);
		const tasks = index.tasksIn('Journal/2026/09/21.md');
		expect(tasks).toHaveLength(3);
		expect(tasks[0]).toMatchObject({ status: 'done', startMin: 570, endMin: 600, text: 'Morning stretch' });
		expect(tasks[1]).toMatchObject({ status: 'todo', startMin: null, quadrant: 1 });
	});

	it('keeps fenced Backlog tasks out of the open list', () => {
		index.put('Journal/2026/09/21.md', DAILY);
		expect(index.findTasks({ statuses: OPEN_STATUSES }).map((t) => t.text)).toEqual(['Walk the dog']);
	});

	it('replaces rather than duplicates on re-put', () => {
		index.put('a.md', DAILY);
		index.put('a.md', DAILY);
		expect(index.tasksIn('a.md')).toHaveLength(3);
	});

	it('forgets a deleted note completely', () => {
		index.put('a.md', DAILY);
		index.forget('a.md');
		expect(index.tasksIn('a.md')).toEqual([]);
		expect(index.search('stretch')).toEqual([]);
	});
});

describe('findTasks', () => {
	it('can exclude a folder, so repeated template tasks do not bury real work', () => {
		index.put('Journal/2026/09/20.md', '- [ ] Morning stretch `Q1`');
		index.put('Journal/2026/09/19.md', '- [ ] Morning stretch `Q1`');
		index.put('Work/Project.md', '- [ ] Ship the thing `Q1`');
		expect(index.findTasks({ statuses: OPEN_STATUSES }).length).toBe(3);
		expect(index.findTasks({ statuses: OPEN_STATUSES, excludePrefixes: ['Journal/'] }).map((t) => t.text)).toEqual(['Ship the thing']);
	});

	it('filters by quadrant', () => {
		index.put('Work/Project.md', '- [ ] One `Q1`\n- [ ] Two `Q2`');
		expect(index.findTasks({ statuses: OPEN_STATUSES, quadrant: 2 }).map((t) => t.text)).toEqual(['Two']);
	});
});

describe('search', () => {
	it('finds a note by body text', () => {
		index.put('Computer Science/Binary Arithmetic.md', '# Binary Arithmetic\n\nTwos complement and the adder.');
		const hits = index.search('complement');
		expect(hits).toHaveLength(1);
		expect(hits[0].title).toBe('Binary Arithmetic');
		expect(hits[0].snippet).toContain('«');
	});

	it('matches prefixes, as a search box should', () => {
		index.put('a.md', '# Anonymisation\n\nStripping identifiers at the byte level');
		expect(index.search('anonym').map((h) => h.title)).toEqual(['Anonymisation']);
	});

	it('returns nothing for an empty or unparseable query instead of throwing', () => {
		index.put('a.md', '# A\ntext');
		expect(index.search('')).toEqual([]);
		expect(index.search('"""')).toEqual([]);
		expect(index.search('   ')).toEqual([]);
	});
});

describe('backlinks', () => {
	it('lists notes pointing at a name', () => {
		index.put('Journal/2026/09/21.md', 'See [[Handbook]] today');
		index.put('Work/Handbook.md', '# Handbook');
		expect(index.backlinks('Handbook').map((b) => b.path)).toEqual(['Journal/2026/09/21.md']);
	});
});

describe('health', () => {
	it('counts what it holds', () => {
		index.put('a.md', DAILY);
		const health = index.health();
		expect(health.notes).toBe(1);
		expect(health.tasks).toBe(3);
		expect(health.problems).toEqual([]);
	});
});

describe('ftsQuery', () => {
	it('ands prefix terms', () => {
		expect(ftsQuery('floating point')).toBe('"floating"* AND "point"*');
	});
	it('strips operators that would be a syntax error', () => {
		expect(ftsQuery('a"b* (c)')).toBe('"a"* AND "b"* AND "c"*');
	});
});

// Rebuilding the whole real vault, to hold the phase 0 performance target.
const VAULT = process.env.VAULT_PATH ?? '';
const SKIP = ['.git', '.obsidian', '.stversions', '.stfolder', 'node_modules', 'Excalidraw'];
function markdownFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (SKIP.includes(entry)) continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) markdownFiles(path, out);
		else if (entry.endsWith('.md')) out.push(path);
	}
	return out;
}

describe.skipIf(!VAULT || !existsSync(VAULT))('rebuilding a real vault', () => {
	it('indexes every note in under ten seconds', () => {
		const notes = markdownFiles(VAULT).map((p) => ({
			path: p.slice(VAULT.length + 1),
			content: readFileSync(p, 'utf8')
		}));
		const took = index.rebuild(notes);
		const health = index.health();
		expect(health.notes).toBe(notes.length);
		expect(health.problems).toEqual([]);
		expect(took).toBeLessThan(10_000);
		console.log(`  indexed ${health.notes} notes, ${health.tasks} tasks, ${health.links} links in ${took} ms`);
	});
});

describe('resolveLink', () => {
	it('finds a note by its file name wherever it lives', () => {
		index.put('Work/Client/Handbook.md', '# Handbook');
		expect(index.resolveLink('Handbook')).toBe('Work/Client/Handbook.md');
	});

	it('matches names with spaces and punctuation', () => {
		index.put('Study/Courses/Algorithms Course (Part 2).md', '# Algorithms');
		expect(index.resolveLink('Algorithms Course (Part 2)')).toBe('Study/Courses/Algorithms Course (Part 2).md');
	});

	it('prefers the shallowest note when a name is ambiguous', () => {
		index.put('README.md', 'a');
		index.put('Inbox/README.md', 'b');
		expect(index.resolveLink('README')).toBe('README.md');
	});

	it('returns null for a link with no note behind it', () => {
		expect(index.resolveLink('Nothing Here')).toBeNull();
	});
});

describe('tags, dependencies and membership', () => {
	const WORK = [
		'# Work',
		'- [ ] Ship the API `Q1` #ws/work 🆔 api1',
		'- [/] Write the docs `Q2` #ws/work ⛔ api1',
		'- [ ] A checklist line with no quadrant at all'
	].join('\n');

	beforeEach(() => index.put('Work/plan.md', WORK));

	it('finds a task by the tag on its line, nested tags included', () => {
		expect(index.findTasks({ tags: ['ws'] }).length).toBe(2);
		expect(index.findTasks({ tags: ['ws/work'] }).map((t) => t.text)).toEqual(['Ship the API', 'Write the docs']);
	});

	it('finds a task by the folder it lives in', () => {
		expect(index.findTasks({ under: ['Work'] }).length).toBe(3);
		expect(index.findTasks({ under: ['Somewhere else'] })).toEqual([]);
	});

	it('treats tag and folder as alternatives, not as both required', () => {
		index.put('Journal/2026/09/21.md', '- [ ] Tagged elsewhere `Q1` #ws/work');
		const found = index.findTasks({ tags: ['ws/work'], under: ['Work'] });
		expect(found.map((t) => t.path)).toContain('Journal/2026/09/21.md');
		expect(found.map((t) => t.path)).toContain('Work/plan.md');
	});

	it('carries the id and the dependency back out', () => {
		const [docs] = index.findTasks({ blocked: true });
		expect(docs.text).toBe('Write the docs');
		expect(docs.blockedBy).toEqual(['api1']);
		expect(index.tasksByIds(['api1'])[0].text).toBe('Ship the API');
		expect(index.tasksByIds(['gone'])).toEqual([]);
		expect(index.tasksByIds([])).toEqual([]);
	});

	it('leaves out the dated daily notes without leaving out the folder', () => {
		index.put('Journal/2026/09/21.md', '- [ ] From a daily note `Q1`');
		index.put('Journal/Projects/Shop/Staff.md', '- [ ] From a workspace note `Q1`');
		const found = index.findTasks({ excludeDailyNotes: true, requireQuadrant: true });
		expect(found.map((t) => t.text)).toContain('From a workspace note');
		expect(found.map((t) => t.text)).not.toContain('From a daily note');
	});

	it('finds what is due on or before a date', () => {
		index.put('Work/dates.md', '- [ ] Soon `Q1` 📅 2026-09-21\n- [ ] Later `Q1` 📅 2026-12-01');
		expect(index.findTasks({ dueOnOrBefore: '2026-09-30' }).map((t) => t.text)).toEqual(['Soon']);
	});
});

describe('schema changes', () => {
	it('throws the cache away rather than migrating it', () => {
		// The index holds nothing the markdown does not, and the hub rebuilds it
		// at every boot, so dropping is always correct and always cheap.
		const file = join(tmpdir(), `prosoche-schema-${Date.now()}.db`);
		try {
			const first = new NoteIndex(file);
			first.put('a.md', '- [ ] Something `Q1`');
			expect(first.health().tasks).toBe(1);
			first.close();

			const raw = new Database(file);
			raw.prepare("UPDATE meta SET value = '1' WHERE key = 'schema_version'").run();
			raw.close();

			const second = new NoteIndex(file);
			expect(second.health().tasks).toBe(0);
			second.put('a.md', '- [ ] Something `Q1`');
			expect(second.health().tasks).toBe(1);
			second.close();
		} finally {
			for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
		}
	});
});
