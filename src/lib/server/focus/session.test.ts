import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Vault } from '../vault/index';
import { DEFAULT_WARMUP_MINUTES, endSession, extendSession, openBlockAt, readSession, startBlockSession, startedRaws } from './session';

const DAY = '2026-10-21';
const NOTE_PATH = 'Journal/2026/10/21.md';
const at = (h: number, m: number) => new Date(2026, 9, 21, h, m).getTime();
const MIN = 60_000;

const BLOCK = '- [ ] 17:00 - 17:30 Cook dinner `Q2`';
const DAYNOTE = ['# Tasks', '- [ ] Meditate `Q1`', BLOCK, '- [ ] 09:00 - 09:02 Tiny', '- [x] 08:00 - 08:30 Ticked', '## Backlog', '```', '- [ ] 10:00 - 11:00 Fenced', '```', ''].join('\n');
const LINE = 2;

describe('a focus session on a block', () => {
	let root: string;
	let vault: Vault;
	const put = async (path: string, content: string) => {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	};
	const read = (path: string) => readFile(join(root, path), 'utf8');
	const start = (now = at(17, 0), raw = BLOCK, line = LINE, warmup?: number) => startBlockSession(vault, { day: DAY, line, raw }, now, warmup);

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'prosoche-focus-'));
		vault = new Vault(root);
		await put(NOTE_PATH, DAYNOTE);
	});
	afterEach(() => rm(root, { recursive: true, force: true }));

	it('starts for the block’s length, capturing the default warm-up and the block', async () => {
		const started = await start();
		expect(started).toMatchObject({
			ok: true,
			session: { kind: 'block', minutes: 30, warmupMin: DEFAULT_WARMUP_MINUTES, day: DAY, block: { raw: BLOCK, line: LINE, startMin: 1020, endMin: 1050, text: 'Cook dinner' } }
		});
		expect(await readSession(vault)).toEqual(started.ok ? started.session : null);
		expect(startedRaws(await readSession(vault))).toEqual([BLOCK]);
	});

	it('started inside the block it runs to the block’s end, but never less than the warm-up', async () => {
		const inside = await start(at(17, 12));
		expect(inside).toMatchObject({ ok: true, session: { minutes: 18 } });
		await rm(join(root, '_hub'), { recursive: true });
		const late = await start(at(17, 28));
		expect(late).toMatchObject({ ok: true, session: { minutes: 5 } });
	});

	it('started before or after the block it uses the block’s whole length', async () => {
		expect(await start(at(16, 0))).toMatchObject({ ok: true, session: { minutes: 30 } });
		await rm(join(root, '_hub'), { recursive: true });
		expect(await start(at(19, 0))).toMatchObject({ ok: true, session: { minutes: 30 } });
	});

	it('takes the warm-up from the caller, and a block shorter than it still gets the warm-up', async () => {
		expect(await start(at(9, 0), '- [ ] 09:00 - 09:02 Tiny', 3, 10)).toMatchObject({ ok: true, session: { warmupMin: 10, minutes: 10 } });
	});

	it('finds the block by its words when its line moved, and refuses `moved` when it is gone', async () => {
		await put(NOTE_PATH, '# Tasks\n- [ ] A new first line\n' + DAYNOTE.slice('# Tasks\n'.length));
		expect(await start()).toMatchObject({ ok: true, session: { block: { line: LINE + 1 } } });
		await rm(join(root, '_hub'), { recursive: true });
		await put(NOTE_PATH, DAYNOTE.replace('Cook dinner', 'Cook lunch'));
		expect(await start()).toMatchObject({ ok: false, reason: 'moved' });
		await rm(join(root, NOTE_PATH));
		expect(await start()).toMatchObject({ ok: false, reason: 'moved' });
	});

	it('refuses a line that is not an open timed block: untimed, ticked, fenced', async () => {
		for (const [raw, line] of [['- [ ] Meditate `Q1`', 1], ['- [x] 08:00 - 08:30 Ticked', 4], ['- [ ] 10:00 - 11:00 Fenced', 7]] as const) {
			expect(await start(at(10, 0), raw, line)).toMatchObject({ ok: false, reason: expect.stringMatching(/not-a-block|moved/) });
		}
		expect(await readSession(vault)).toBeNull();
	});

	it('starting the same block twice answers the same session; another block is busy and named', async () => {
		const a = await start(at(17, 0));
		const b = await start(at(17, 3));
		expect(a.ok && b.ok && b.session.startedAt === a.session.startedAt).toBe(true);
		expect(await start(at(17, 3), '- [ ] 09:00 - 09:02 Tiny', 3)).toMatchObject({ ok: false, reason: 'busy', message: expect.stringContaining('Cook dinner') });
	});

	it('+15 min extends the timer and moves the block’s end in the note', async () => {
		await start();
		expect(await extendSession(vault, 15)).toMatchObject({ ok: true, session: { minutes: 45, block: { endMin: 1065, raw: BLOCK.replace('17:30', '17:45') } } });
		expect(await read(NOTE_PATH)).toBe(DAYNOTE.replace('17:00 - 17:30', '17:00 - 17:45'));
		expect(await extendSession(vault, 15)).toMatchObject({ ok: true });
		expect(await read(NOTE_PATH)).toContain('17:00 - 18:00 Cook dinner');
		await endSession(vault, 'progress', '', at(17, 25));
		expect(await read(NOTE_PATH)).toContain('- [x] 17:00 - 18:00 Cook dinner `Q2`\n\t- Focus: Cook dinner, 25m, progress\n');
	});

	it('Done and Made progress tick the block and write one Focus bullet; nothing else changes', async () => {
		for (const outcome of ['done', 'progress'] as const) {
			await put(NOTE_PATH, DAYNOTE);
			await start();
			expect(await endSession(vault, outcome, 'went  well\nreally', at(17, 25))).toMatchObject({ ok: true, minutes: 25, warnings: [] });
			expect(await read(NOTE_PATH)).toBe(
				DAYNOTE.replace(BLOCK, `- [x] 17:00 - 17:30 Cook dinner \`Q2\`\n\t- Focus: Cook dinner, 25m, ${outcome} · went well really`)
			);
			expect(await readSession(vault)).toBeNull();
		}
	});

	it('Didn’t get to it ticks nothing but still writes the bullet, so the block counts as dealt with', async () => {
		await start();
		await endSession(vault, 'skipped', '', at(17, 1));
		expect(await read(NOTE_PATH)).toBe(DAYNOTE.replace(BLOCK, `${BLOCK}\n\t- Focus: Cook dinner, 1m, skipped`));
	});

	it('puts the bullet after the block’s existing sub-bullets', async () => {
		await put(NOTE_PATH, DAYNOTE.replace(BLOCK, `${BLOCK}\n\t- an existing note`));
		await start();
		await endSession(vault, 'progress', '', at(17, 10));
		expect(await read(NOTE_PATH)).toContain(`${BLOCK.replace('[ ]', '[x]')}\n\t- an existing note\n\t- Focus: Cook dinner, 10m, progress\n`);
	});

	it('warns, and writes nothing, when the block was deleted or the note is gone', async () => {
		await start();
		await put(NOTE_PATH, '# Tasks\n');
		expect(await endSession(vault, 'done', '', at(17, 5))).toMatchObject({ ok: true, warnings: [expect.stringContaining('not in the note')] });
		expect(await read(NOTE_PATH)).toBe('# Tasks\n');
		expect(await readSession(vault)).toBeNull();

		await put(NOTE_PATH, DAYNOTE);
		await start();
		await rm(join(root, NOTE_PATH));
		expect(await endSession(vault, 'done', '', at(17, 5))).toMatchObject({ ok: true, warnings: [expect.stringContaining('does not exist')] });
	});

	it('openBlockAt answers only an open, timed, unfenced task line', async () => {
		expect(await openBlockAt(vault, DAY, LINE)).toMatchObject({ raw: BLOCK, startMin: 1020, endMin: 1050, text: 'Cook dinner' });
		for (const line of [0, 1, 4, 7, 99]) expect(await openBlockAt(vault, DAY, line)).toBeNull();
		expect(await openBlockAt(vault, '2026-01-01', 0)).toBeNull();
	});

	it('ending, or extending, with none running is refused', async () => {
		expect(await endSession(vault, 'done', '', at(17, 0))).toMatchObject({ ok: false, reason: 'no-session' });
		expect(await extendSession(vault, 15)).toMatchObject({ ok: false, reason: 'no-session' });
		expect(startedRaws(null)).toEqual([]);
	});
});

describe('moving the old study session file', () => {
	let root: string;
	let vault: Vault;
	const OLD = '_hub/.state/study-session.json';
	const NEW = '_hub/.state/focus-session.json';
	const put = async (path: string, content: string) => {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	};
	const exists = (path: string) => readFile(join(root, path), 'utf8').then(() => true, () => false);
	const OLD_SESSION = {
		subject: 'fullstack',
		name: 'Fullstack',
		startedAt: at(17, 2),
		minutes: 30,
		day: DAY,
		step: { path: 'Study/Fullstack/Goals.md', line: 1, raw: '- [ ] Step', text: 'Step', first: null, est: null },
		block: { raw: '- [ ] 17:00 - 17:30 Study Fullstack `Q2`', startMin: 1020, endMin: 1050 }
	};

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'prosoche-focus-mig-'));
		vault = new Vault(root);
	});
	afterEach(() => rm(root, { recursive: true, force: true }));

	it('reads it as a study session, writes the new file and removes the old', async () => {
		await put(OLD, JSON.stringify(OLD_SESSION));
		const session = await readSession(vault);
		expect(session).toMatchObject({
			kind: 'study',
			subject: 'fullstack',
			warmupMin: DEFAULT_WARMUP_MINUTES,
			names: ['Fullstack'],
			block: { raw: OLD_SESSION.block.raw, line: -1, startMin: 1020, endMin: 1050, text: 'Study Fullstack' }
		});
		expect(await exists(OLD)).toBe(false);
		expect(await exists(NEW)).toBe(true);
		expect(await readSession(vault)).toEqual(session);
	});

	it('a migrated session still ends: the block is found by its words and logged', async () => {
		await put(OLD, JSON.stringify(OLD_SESSION));
		await put('Study/Fullstack/Goals.md', '## G\n- [ ] Step\n');
		await put(NOTE_PATH, '# Tasks\n- [ ] 17:00 - 17:30 Study Fullstack `Q2`\n');
		expect(await endSession(vault, 'done', '', at(17, 27))).toMatchObject({ ok: true, minutes: 25, warnings: [] });
		expect(await readFile(join(root, NOTE_PATH), 'utf8')).toBe('# Tasks\n- [x] 17:00 - 17:30 Study Fullstack `Q2`\n\t- Fullstack: Step, 25m, done\n');
		expect(await readFile(join(root, 'Study/Fullstack/Goals.md'), 'utf8')).toBe('## G\n- [x] Step\n');
	});

	it('the new file wins when both exist, and an unreadable old file reads as none and is removed', async () => {
		await put(NEW, JSON.stringify({ ...OLD_SESSION, kind: 'study', warmupMin: 7, names: ['Fullstack'], block: null }));
		await put(OLD, JSON.stringify({ ...OLD_SESSION, subject: 'other' }));
		expect(await readSession(vault)).toMatchObject({ subject: 'fullstack', warmupMin: 7 });
		expect(await exists(OLD)).toBe(true);

		await rm(join(root, NEW));
		await put(OLD, '{not json');
		expect(await readSession(vault)).toBeNull();
		expect(await exists(OLD)).toBe(false);
		expect(await exists(NEW)).toBe(false);
	});
});
