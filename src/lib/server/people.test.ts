import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { NoteIndex } from './index/index';
import { PEOPLE_FOLDER, listPeople, logContact, person, personName, personPath } from './people';

const ADA = `---
type: person
org: Acme
role: Analyst
---

# Ada Lovelace

## Follow-ups
- [ ] Send the anonymisation plan \`Q2\` 📅 2026-09-23
- [x] Already dealt with this one

## Log
- 2026-09-14 First call.
- 2026-09-18 Agreed the byte-level approach.
`;

const KICKOFF = `# Kickoff

Met [[Ada Lovelace]] about the handbook.

- [ ] Draft the brief for [[Ada Lovelace]] \`Q1\`
	- ask about [[Grace Hopper]] too
- [x] Book the room with [[Ada Lovelace]] \`Q1\`
`;

const DAILY = `# Tasks
- [ ] 10:00 - 10:30 Call [[Ada Lovelace]] \`Q1\`
`;

let root: string;
let vault: Vault;
let index: NoteIndex;

/** Put a note in the vault and in the index, which is how the app keeps them. */
async function add(path: string, content: string) {
	await vault.write(path, content);
	index.put(path, content);
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-people-'));
	vault = new Vault(root);
	index = new NoteIndex(':memory:');
});
afterEach(async () => {
	index.close();
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

describe('personName and personPath', () => {
	const cases: Array<[string, string]> = [
		['Ada Lovelace', 'Ada Lovelace'],
		['Ada Lovelace.md', 'Ada Lovelace'],
		['  Ada   Lovelace  ', 'Ada Lovelace'],
		['../../etc/passwd', 'etc passwd'],
		['Ada/Lovelace', 'Ada Lovelace'],
		['...', ''],
		['', '']
	];
	for (const [input, expected] of cases) {
		it(`reads ${JSON.stringify(input)} as ${JSON.stringify(expected)}`, () => {
			expect(personName(input)).toBe(expected);
		});
	}

	it('puts a person in the people folder', () => {
		expect(personPath('Ada Lovelace')).toBe(`${PEOPLE_FOLDER}/Ada Lovelace.md`);
	});
});

describe('person', () => {
	beforeEach(async () => {
		await add(`${PEOPLE_FOLDER}/Ada Lovelace.md`, ADA);
		await add('Work/Kickoff.md', KICKOFF);
		await add('Journal/2026/09/21.md', DAILY);
	});

	it('gathers the note, the log and everyone who mentions them', async () => {
		const ada = await person(vault, index, 'Ada Lovelace');
		expect(ada.exists).toBe(true);
		expect(ada.org).toBe('Acme');
		expect(ada.role).toBe('Analyst');
		expect(ada.log.map((l) => l.day)).toEqual(['2026-09-14', '2026-09-18']);
		expect(ada.log[1].text).toBe('Agreed the byte-level approach.');
		expect(ada.mentionedIn.map((m) => m.path)).toEqual(['Journal/2026/09/21.md', 'Work/Kickoff.md']);
		expect(ada.mentionedIn[1].title).toBe('Kickoff');
	});

	it('counts one mention per note, however often it links', async () => {
		expect((await person(vault, index, 'Ada Lovelace')).mentions).toBe(2);
	});

	it('collects open follow-ups from their note and from tasks that mention them', async () => {
		const ada = await person(vault, index, 'Ada Lovelace');
		expect(ada.followUps.map((t) => t.text)).toEqual([
			'Send the anonymisation plan',
			'Call [[Ada Lovelace]]',
			'Draft the brief for [[Ada Lovelace]]'
		]);
		expect(ada.openFollowUps).toBe(3);
		expect(ada.nextDue).toBe('2026-09-23');
	});

	it('leaves finished work out of the follow-ups', async () => {
		const ada = await person(vault, index, 'Ada Lovelace');
		expect(ada.followUps.map((t) => t.text)).not.toContain('Book the room with [[Ada Lovelace]]');
		expect(ada.followUps.map((t) => t.text)).not.toContain('Already dealt with this one');
	});

	it('counts a task whose sub-bullet names them', async () => {
		const grace = await person(vault, index, 'Grace Hopper');
		expect(grace.followUps.map((t) => t.text)).toEqual(['Draft the brief for [[Ada Lovelace]]']);
	});

	it('dates the last contact from the newest log line', async () => {
		expect((await person(vault, index, 'Ada Lovelace')).lastContact).toBe('2026-09-21');
	});

	it('reads a person with no note as a person with an empty note', async () => {
		const grace = await person(vault, index, 'Grace Hopper');
		expect(grace).toMatchObject({
			name: 'Grace Hopper',
			exists: false,
			body: '',
			log: [],
			lastContact: null,
			path: `${PEOPLE_FOLDER}/Grace Hopper.md`
		});
		expect(grace.mentionedIn.map((m) => m.path)).toEqual(['Work/Kickoff.md']);
	});

	it('finds a person note filed outside the people folder', async () => {
		await add('Work/Team/Bob Barker.md', '---\ntype: person\n---\n\n## Log\n- 2026-09-01 Hello.\n');
		const bob = await person(vault, index, 'Bob Barker');
		expect(bob.path).toBe('Work/Team/Bob Barker.md');
		expect(bob.exists).toBe(true);
		expect(bob.lastContact).toBe('2026-09-01');
	});

	it('cannot be asked about a name that climbs out of the vault', async () => {
		const nobody = await person(vault, index, '../../etc/passwd');
		expect(nobody.exists).toBe(false);
		expect(nobody.path).toBe(`${PEOPLE_FOLDER}/etc passwd.md`);
	});
});

describe('listPeople', () => {
	beforeEach(async () => {
		await add(`${PEOPLE_FOLDER}/Ada Lovelace.md`, ADA);
		await add(`${PEOPLE_FOLDER}/Bob Barker.md`, '---\ntype: person\nworkspaces: [personal]\n---\n\n## Log\n- 2026-09-02 Beer.\n');
		await add(`${PEOPLE_FOLDER}/Carol Kaye.md`, '---\ntype: person\n---\n\n## Log\n- 2026-09-19 Session.\n');
		await add('Work/Kickoff.md', KICKOFF);
	});

	it('lists everyone with a note when nothing narrows it', async () => {
		const people = await listPeople(vault, index);
		expect(people.map((p) => p.name)).toEqual(['Ada Lovelace', 'Bob Barker', 'Carol Kaye']);
	});

	it('puts people with a dated follow-up first, then the longest unheard-from', async () => {
		const people = await listPeople(vault, index);
		// Ada has a follow-up due 2026-09-23; between the other two, Bob was last
		// spoken to on the 2nd and Carol on the 19th.
		expect(people.map((p) => [p.name, p.openFollowUps, p.lastContact])).toEqual([
			['Ada Lovelace', 2, '2026-09-18'],
			['Bob Barker', 0, '2026-09-02'],
			['Carol Kaye', 0, '2026-09-19']
		]);
	});

	it('narrows to the people a folder talks about', async () => {
		const people = await listPeople(vault, index, { folders: ['Work'] });
		expect(people.map((p) => p.name)).toEqual(['Ada Lovelace']);
	});

	it('narrows to the people a workspace claims in their own frontmatter', async () => {
		const people = await listPeople(vault, index, { folders: ['Inbox'], slug: 'personal' });
		expect(people.map((p) => p.name)).toEqual(['Bob Barker']);
	});

	it('is empty, rather than an error, when nobody is in scope', async () => {
		expect(await listPeople(vault, index, { folders: ['Nowhere'] })).toEqual([]);
	});

	it('carries the same follow-up counts the person page shows', async () => {
		const ada = (await listPeople(vault, index)).find((p) => p.name === 'Ada Lovelace')!;
		expect(ada.openFollowUps).toBe((await person(vault, index, 'Ada Lovelace')).openFollowUps);
	});
});

describe('logContact', () => {
	it('appends a dated line and changes nothing else', async () => {
		await add(`${PEOPLE_FOLDER}/Ada Lovelace.md`, ADA);
		const result = await logContact(vault, 'Ada Lovelace', '  Talked about  the schema  ', '2026-09-21');
		expect(result).toMatchObject({ ok: true, created: false, day: '2026-09-21' });

		const after = (await vault.read(`${PEOPLE_FOLDER}/Ada Lovelace.md`)).content.split('\n');
		const before = ADA.split('\n');
		expect(after).toHaveLength(before.length + 1);
		expect(after[result.ok ? result.line : 0]).toBe('- 2026-09-21 Talked about the schema');
		expect(after.toSpliced(result.ok ? result.line : 0, 1)).toEqual(before);
	});

	it('creates the note for someone who did not have one', async () => {
		const result = await logContact(vault, 'Grace Hopper', 'Met at the conference', '2026-09-21');
		expect(result).toMatchObject({ ok: true, created: true, path: `${PEOPLE_FOLDER}/Grace Hopper.md` });

		const content = (await vault.read(`${PEOPLE_FOLDER}/Grace Hopper.md`)).content;
		expect(content).toContain('type: person');
		expect(content).toContain('## Follow-ups');
		expect(content).toContain('## Log\n- 2026-09-21 Met at the conference');
	});

	it('adds a Log heading to a note that has none, leaving the rest alone', async () => {
		await add(`${PEOPLE_FOLDER}/Dan Doe.md`, '---\ntype: person\n---\n\n# Dan Doe\n\nMet through Bob.\n');
		await logContact(vault, 'Dan Doe', 'Coffee', '2026-09-21');
		expect((await vault.read(`${PEOPLE_FOLDER}/Dan Doe.md`)).content).toBe(
			'---\ntype: person\n---\n\n# Dan Doe\n\nMet through Bob.\n\n## Log\n- 2026-09-21 Coffee\n'
		);
	});

	it('logs twice in a day without disturbing the first line', async () => {
		await logContact(vault, 'Grace Hopper', 'Morning call', '2026-09-21');
		await logContact(vault, 'Grace Hopper', 'Afternoon email', '2026-09-21');
		expect((await vault.read(`${PEOPLE_FOLDER}/Grace Hopper.md`)).content).toContain(
			'- 2026-09-21 Morning call\n- 2026-09-21 Afternoon email'
		);
	});

	it('refuses a nameless or empty contact rather than writing a stray file', async () => {
		expect(await logContact(vault, '   ', 'something')).toEqual({ ok: false, reason: 'no-name' });
		expect(await logContact(vault, 'Ada Lovelace', '   ')).toEqual({ ok: false, reason: 'no-text' });
		expect(await vault.list()).toEqual([]);
	});

	it('shows up as the last contact straight afterwards', async () => {
		await logContact(vault, 'Grace Hopper', 'Met at the conference', '2026-09-21');
		const note = await vault.read(`${PEOPLE_FOLDER}/Grace Hopper.md`);
		index.put(note.path, note.content);
		expect((await person(vault, index, 'Grace Hopper')).lastContact).toBe('2026-09-21');
	});
});
