import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { PushConfig } from '../config';
import type { Sender } from '../notify';
import { Vault } from '../vault/index';
import { composeNoPlan, composeNudge, nudgeTick } from './nudge';
import { startBlockSession } from './session';
import { FOCUS_SETTINGS_PATH } from './settings';
import type { DueBlock, Nudge } from './due';

const ON: PushConfig = { state: 'on', publicKey: 'pub', privateKey: 'priv', subject: 'mailto:someone@example.com' };
const OFF: PushConfig = { state: 'off' };
const DAY = '2026-10-21';
const NOTE_PATH = 'Journal/2026/10/21.md';
const STATE_PATH = '_hub/.state/nudges.json';
const at = (h: number, m: number, s = 0, day = 21) => new Date(2026, 9, day, h, m, s);

const COOK = '- [ ] 17:00 - 17:30 Cook dinner `Q2`';
const NOTE = ['# Tasks', '- [ ] Meditate `Q1`', COOK, ''].join('\n');
const DEVICE = [{ endpoint: 'https://push.example.com/abc', label: 'Test phone', addedAt: '2026-10-01T00:00:00.000Z', keys: { p256dh: 'AAAA', auth: 'BBBB' } }];

const block = (line: number, text: string, startMin: number): DueBlock => ({ line, blockEnd: line, raw: `- [ ] ${text}`, text, startMin, endMin: startMin + 30 });
const nudge = (kind: Nudge['kind'], blocks: DueBlock[]): Nudge => ({ kind, key: 'k', startMin: blocks[0].startMin, blocks });

describe('composeNudge', () => {
	const one = [block(7, 'Fullstack', 17 * 60)];
	const pair = [block(3, 'Read', 18 * 60), block(4, 'Stretch', 18 * 60)];
	const cases: Array<[string, Nudge, { title: string; body: string; url: string; tag: string }]> = [
		['wind-down, one block', nudge('wind-down', one), { title: 'Fullstack at 17:00', body: 'Finish this match. It starts in 10 min.', url: `/focus/start?day=${DAY}&line=7`, tag: 'focus-1020' }],
		['start, one block', nudge('start', one), { title: 'Fullstack now', body: 'Just five minutes.', url: `/focus/start?day=${DAY}&line=7`, tag: 'focus-1020' }],
		['follow-up, one block', nudge('follow-up', one), { title: "Fullstack hasn't started", body: 'Start, or let it go.', url: `/focus/start?day=${DAY}&line=7`, tag: 'focus-1020' }],
		['wind-down, a group', nudge('wind-down', pair), { title: 'Read, Stretch at 18:00', body: 'Finish this match. It starts in 10 min.', url: '/today', tag: 'focus-1080' }],
		['start, a group', nudge('start', pair), { title: 'Read, Stretch now', body: 'Just five minutes.', url: '/today', tag: 'focus-1080' }]
	];
	it.each(cases)('%s', (_name, n, expected) => {
		expect(composeNudge(n, DAY, 10, 5)).toEqual(expected);
	});

	it('repeats the settings in its words', () => {
		expect(composeNudge(nudge('wind-down', one), DAY, 20, 5).body).toBe('Finish this match. It starts in 20 min.');
		expect(composeNudge(nudge('start', one), DAY, 10, 3).body).toBe('Just three minutes.');
		expect(composeNudge(nudge('start', one), DAY, 10, 1).body).toBe('Just one minute.');
	});

	it('says the plan is missing', () => {
		expect(composeNoPlan()).toMatchObject({ title: 'Today has no plan yet', body: 'Open Today and time-block it.', url: '/today' });
	});
});

describe('nudgeTick', () => {
	let root: string;
	let vault: Vault;
	let sender: ReturnType<typeof vi.fn<Sender>>;
	const put = async (path: string, content: string) => {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	};
	const tick = (now: Date, push: PushConfig = ON) => nudgeTick(vault, now, sender, push);
	const titles = () => sender.mock.calls.map((c) => JSON.parse(c[1]).title);

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'prosoche-nudge-'));
		vault = new Vault(root);
		sender = vi.fn<Sender>(async () => ({}));
		await put(NOTE_PATH, NOTE);
		await put('_hub/.state/push.json', JSON.stringify(DEVICE));
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await rm(root, { recursive: true, force: true });
	});

	it('sends each kind at its moment, with the link and tag a tap needs', async () => {
		expect(await tick(at(16, 49))).toEqual([]);
		expect(await tick(at(16, 50))).toHaveLength(1);
		expect(await tick(at(17, 0))).toHaveLength(1);
		expect(await tick(at(17, 10))).toHaveLength(1);
		expect(titles()).toEqual(['Cook dinner at 17:00', 'Cook dinner now', "Cook dinner hasn't started"]);
		const first = JSON.parse(sender.mock.calls[0][1]);
		expect(first).toMatchObject({ url: `/focus/start?day=${DAY}&line=2`, tag: 'focus-1020', body: 'Finish this match. It starts in 10 min.' });
		expect(sender.mock.calls[0][0]).toMatchObject({ endpoint: DEVICE[0].endpoint });
	});

	it('sends a nudge once across ticks, and across a restart', async () => {
		expect(await tick(at(17, 0, 0))).toHaveLength(1);
		expect(await tick(at(17, 0, 30))).toEqual([]);
		expect(await tick(at(17, 1))).toEqual([]);
		// A restart keeps nothing in memory: the next tick has only the file.
		const restarted = new Vault(root);
		expect(await nudgeTick(restarted, at(17, 2), sender, ON)).toEqual([]);
		expect(sender).toHaveBeenCalledTimes(1);
		expect(JSON.parse(await readFile(join(root, STATE_PATH), 'utf8'))).toMatchObject({ day: DAY, sent: [expect.stringMatching(/^start:1020:/)] });
	});

	it('does not send a nudge that is long past', async () => {
		expect(await tick(at(17, 5))).toEqual([]);
		expect(sender).not.toHaveBeenCalled();
	});

	it('starts the list again on a new day', async () => {
		await put(STATE_PATH, JSON.stringify({ day: '2026-10-20', sent: ['start:1020:stale'] }));
		await put('Journal/2026/10/22.md', COOK + '\n');
		expect(await tick(at(17, 0, 0, 22))).toHaveLength(1);
		expect(JSON.parse(await readFile(join(root, STATE_PATH), 'utf8'))).toMatchObject({ day: '2026-10-22', sent: [expect.any(String)] });
		expect(JSON.parse(await readFile(join(root, STATE_PATH), 'utf8')).sent).toHaveLength(1);
	});

	it('sends nothing for a block with a running session', async () => {
		const started = await startBlockSession(vault, { day: DAY, line: 2, raw: COOK }, at(16, 58).getTime());
		expect(started.ok).toBe(true);
		expect(await tick(at(17, 0))).toEqual([]);
		expect(await tick(at(17, 10))).toEqual([]);
		expect(sender).not.toHaveBeenCalled();
	});

	it('records a nudge whose push failed, and does not try again', async () => {
		sender.mockRejectedValue(Object.assign(new Error('down'), { statusCode: 500 }));
		expect(await tick(at(17, 0, 0))).toHaveLength(1);
		expect(await tick(at(17, 0, 30))).toEqual([]);
		expect(sender).toHaveBeenCalledTimes(1);
	});

	it('uses the lead times from settings', async () => {
		await put(FOCUS_SETTINGS_PATH, '---\nwind_down_minutes: 20\nwarmup_minutes: 3\n---\n');
		expect(await tick(at(16, 40))).toHaveLength(1);
		expect(JSON.parse(sender.mock.calls[0][1]).body).toBe('Finish this match. It starts in 20 min.');
		await tick(at(17, 0));
		expect(JSON.parse(sender.mock.calls[1][1]).body).toBe('Just three minutes.');
	});

	it('sends one push for blocks that start together', async () => {
		await put(NOTE_PATH, ['- [ ] 18:00 - 18:30 Read', '- [ ] 18:00 - 18:20 Stretch', ''].join('\n'));
		expect(await tick(at(18, 0))).toHaveLength(1);
		expect(JSON.parse(sender.mock.calls[0][1])).toMatchObject({ title: 'Read, Stretch now', url: '/today' });
	});

	describe('no plan', () => {
		beforeEach(() => rm(join(root, NOTE_PATH)));

		it('says so once when there is no note by the plan-by time', async () => {
			expect(await tick(at(9, 59))).toEqual([]);
			expect(await tick(at(10, 0))).toEqual(['no-plan']);
			expect(await tick(at(10, 1))).toEqual([]);
			expect(titles()).toEqual(['Today has no plan yet']);
			expect(JSON.parse(sender.mock.calls[0][1])).toMatchObject({ body: 'Open Today and time-block it.', url: '/today' });
		});

		it('says so for a note with no timed block, and follows the setting', async () => {
			await put(NOTE_PATH, '# Tasks\n- [ ] Meditate `Q1`\n');
			await put(FOCUS_SETTINGS_PATH, '---\nplan_by: "09:30"\n---\n');
			expect(await tick(at(10, 0))).toEqual([]);
			expect(await tick(at(9, 31))).toEqual(['no-plan']);
		});

		it('is silent when the day has a plan, or the moment has passed', async () => {
			await put(NOTE_PATH, NOTE);
			expect(await tick(at(10, 0))).toEqual([]);
			await rm(join(root, NOTE_PATH));
			expect(await tick(at(10, 4))).toEqual([]);
		});
	});

	it('does nothing and records nothing while push is off', async () => {
		expect(await tick(at(17, 0), OFF)).toEqual([]);
		expect(sender).not.toHaveBeenCalled();
		await expect(stat(join(root, STATE_PATH))).rejects.toThrow();
		// Once push is on the nudge is still owed.
		expect(await tick(at(17, 1), ON)).toHaveLength(1);
	});

	it('reads an unreadable state file as nothing sent', async () => {
		await put(STATE_PATH, 'not json');
		expect(await tick(at(17, 0))).toHaveLength(1);
		expect(console.error).toHaveBeenCalled();
	});
});
