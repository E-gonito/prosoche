import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Vault } from '../vault/index';
import { readSubject } from './subjects';
import { studySummary } from './summary';
import { endSession, extendSession, readSession, startSession, weekOf } from './session';

const DAY = '2026-10-21';
const NOW = new Date(2026, 9, 21, 17, 2).getTime();
const MIN = 60_000;

const GOALS = [
	'---',
	'focus: Frontend Depth',
	'---',
	'## Frontend Depth',
	'- [ ] Finish react.dev chapters 📅 2026-11-15',
	'\t- est:: 6–8h',
	'\t- first:: Set a 20-minute timer',
	'- [ ] Second step',
	'## Rails Backend',
	'- [ ] Trace an endpoint'
].join('\n');

const DAYNOTE = ['# Tasks', '- [ ] Meditate `Q1`', '- [ ] 17:00 - 17:30 Study Fullstack `Q2`', '## Backlog', '```', '- [ ] x', '```', ''].join('\n');

describe('a study session', () => {
	let root: string;
	let vault: Vault;
	const subject = readSubject('_hub/subjects/fullstack.md', '---\nname: Fullstack\nfolders:\n  - Study/Fullstack\n---\n');
	const put = async (path: string, content: string) => {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	};
	const read = (path: string) => readFile(join(root, path), 'utf8');
	const summary = () => studySummary(vault, subject);
	const NOTE_PATH = 'Journal/2026/10/21.md';

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'prosoche-session-'));
		vault = new Vault(root);
		await put('Study/Fullstack/Goals.md', GOALS);
		await put(NOTE_PATH, DAYNOTE);
	});
	afterEach(() => rm(root, { recursive: true, force: true }));

	it('starts on the active goal’s first open step, for the block’s length', async () => {
		const started = await startSession(vault, subject, await summary(), DAY, NOW);
		expect(started).toMatchObject({ ok: true, session: { minutes: 30, step: { text: expect.stringContaining('react.dev'), first: 'Set a 20-minute timer' } } });
		expect((await readSession(vault))?.block?.startMin).toBe(1020);
	});

	it('defaults to 30 minutes with no block, and starting twice returns the same session', async () => {
		await put(NOTE_PATH, '# Tasks\n');
		const a = await startSession(vault, subject, await summary(), DAY, NOW);
		const b = await startSession(vault, subject, await summary(), DAY, NOW + MIN);
		expect(a.ok && b.ok && a.session.startedAt === b.session.startedAt && a.session.minutes === 30).toBe(true);
	});

	it('refuses a second subject while one runs', async () => {
		await startSession(vault, subject, await summary(), DAY, NOW);
		const other = readSubject('_hub/subjects/rust.md', '---\nname: Rust\n---\n');
		await put('Study/Rust/Goals.md', '## G\n- [ ] s\n');
		expect(await startSession(vault, other, await studySummary(vault, other), DAY, NOW)).toMatchObject({ ok: false, reason: 'busy' });
	});

	it('refuses a subject with nothing open', async () => {
		await put('Study/Fullstack/Goals.md', '## G\n- [x] done\n');
		expect(await startSession(vault, subject, await summary(), DAY, NOW)).toMatchObject({ ok: false, reason: 'no-step' });
	});

	it('+15 min extends the timer and moves the block’s end in the note', async () => {
		await startSession(vault, subject, await summary(), DAY, NOW);
		const extended = await extendSession(vault, 15);
		expect(extended).toMatchObject({ ok: true, session: { minutes: 45 } });
		expect(await read(NOTE_PATH)).toBe(DAYNOTE.replace('17:00 - 17:30', '17:00 - 17:45'));
		await extendSession(vault, 15);
		expect(await read(NOTE_PATH)).toContain('17:00 - 18:00 Study');
	});

	it('Done ticks the step and the block, logs one bullet, touches nothing else, and clears the session', async () => {
		await startSession(vault, subject, await summary(), DAY, NOW);
		const ended = await endSession(vault, subject, 'done', 'went well', NOW + 25 * MIN);
		expect(ended).toMatchObject({ ok: true, minutes: 25, warnings: [] });
		expect(await read(NOTE_PATH)).toBe(
			DAYNOTE.replace('- [ ] 17:00 - 17:30 Study Fullstack `Q2`', '- [x] 17:00 - 17:30 Study Fullstack `Q2`\n\t- Fullstack: Finish react.dev chapters, 25m, done · went well')
		);
		expect(await read('Study/Fullstack/Goals.md')).toBe(GOALS.replace('- [ ] Finish react.dev', '- [x] Finish react.dev'));
		expect(await readSession(vault)).toBeNull();
	});

	it('Made progress ticks the block but not the step', async () => {
		await startSession(vault, subject, await summary(), DAY, NOW);
		await endSession(vault, subject, 'progress', '', NOW + 10 * MIN);
		expect(await read(NOTE_PATH)).toContain('- [x] 17:00 - 17:30 Study Fullstack `Q2`\n\t- Fullstack: Finish react.dev chapters, 10m, progress\n');
		expect(await read('Study/Fullstack/Goals.md')).toBe(GOALS);
	});

	it('Didn’t get to it logs under the block and ticks nothing', async () => {
		await startSession(vault, subject, await summary(), DAY, NOW);
		await endSession(vault, subject, 'skipped', '', NOW + 1 * MIN);
		const note = await read(NOTE_PATH);
		expect(note).toContain('- [ ] 17:00 - 17:30 Study Fullstack `Q2`\n\t- Fullstack: Finish react.dev chapters, 1m, skipped\n');
		expect(await read('Study/Fullstack/Goals.md')).toBe(GOALS);
	});

	it('with no block, progress appends a ticked one with real times; skipped writes nothing', async () => {
		await put(NOTE_PATH, '# Tasks\n- [ ] Meditate\n## Backlog\n');
		await startSession(vault, subject, await summary(), DAY, NOW);
		await endSession(vault, subject, 'progress', '', NOW + 20 * MIN);
		expect(await read(NOTE_PATH)).toBe('# Tasks\n- [ ] Meditate\n- [x] 17:02 - 17:22 Study Fullstack `Q2`\n\t- Fullstack: Finish react.dev chapters, 20m, progress\n## Backlog\n');

		await put(NOTE_PATH, '# Tasks\n');
		await startSession(vault, subject, await summary(), DAY, NOW);
		await endSession(vault, subject, 'skipped', '', NOW + MIN);
		expect(await read(NOTE_PATH)).toBe('# Tasks\n');
	});

	it('a missing day note is a warning, and the step is still ticked', async () => {
		await rm(join(root, NOTE_PATH));
		await startSession(vault, subject, await summary(), DAY, NOW);
		const ended = await endSession(vault, subject, 'done', '', NOW + 5 * MIN);
		expect(ended).toMatchObject({ ok: true, warnings: [expect.stringContaining('does not exist')] });
		expect(await read('Study/Fullstack/Goals.md')).toContain('- [x] Finish react.dev');
	});

	it('ending with none running is refused', async () => {
		expect(await endSession(vault, subject, 'done', '', NOW)).toMatchObject({ ok: false, reason: 'no-session' });
	});

	it('counts the week from the notes, not the skipped ones', async () => {
		await startSession(vault, subject, await summary(), DAY, NOW);
		await endSession(vault, subject, 'progress', '', NOW + 20 * MIN);
		await put('Journal/2026/10/19.md', '# Tasks\n- [x] a\n\t- Fullstack: x, 40m, done\n\t- Fullstack: y, 5m, skipped\n\t- Rust: z, 60m, done\n');
		await put('Journal/2026/10/10.md', '- [x] a\n\t- Fullstack: old, 99m, done\n');
		expect(await weekOf(vault, subject, DAY)).toEqual({ sessions: 2, minutes: 60 });
	});
});
