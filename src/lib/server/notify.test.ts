import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { readPushConfig } from './config';
import { announcePush, devices, pushStatus, send, subscribe, unsubscribe, type Sender } from './notify';

const KEY = Buffer.alloc(65, 1).toString('base64url');
const SECRET = Buffer.alloc(32, 2).toString('base64url');
const SUBJECT = 'mailto:me@example.com';
const sub = (n: number) => ({ endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: 'BPkey_-1', auth: 'auth_-1' } });
const NOTE = { title: 'Fullstack now', body: 'Just five minutes.', url: '/focus/start?day=2026-10-23&line=12', tag: 'block-12' };

describe('readPushConfig', () => {
	it.each([
		['nothing set', {}, 'off'],
		['blank values', { HUB_VAPID_PUBLIC: ' ', HUB_VAPID_PRIVATE: '' }, 'off'],
		['both keys and a mailto subject', { HUB_VAPID_PUBLIC: KEY, HUB_VAPID_PRIVATE: SECRET, HUB_VAPID_SUBJECT: SUBJECT }, 'on'],
		['both keys and an https subject', { HUB_VAPID_PUBLIC: KEY, HUB_VAPID_PRIVATE: SECRET, HUB_VAPID_SUBJECT: 'https://example.com/contact' }, 'on']
	])('%s', (_, env, state) => expect(readPushConfig(env).state).toBe(state));

	it.each([
		['only the public key', { HUB_VAPID_PUBLIC: KEY, HUB_VAPID_SUBJECT: SUBJECT }, /HUB_VAPID_PRIVATE is not set/],
		['only the private key', { HUB_VAPID_PRIVATE: SECRET, HUB_VAPID_SUBJECT: SUBJECT }, /HUB_VAPID_PUBLIC is not set/],
		['a subject with no keys', { HUB_VAPID_SUBJECT: SUBJECT }, /HUB_VAPID_SUBJECT is set but/],
		['no subject', { HUB_VAPID_PUBLIC: KEY, HUB_VAPID_PRIVATE: SECRET }, /mailto: or https:/],
		['an http subject', { HUB_VAPID_PUBLIC: KEY, HUB_VAPID_PRIVATE: SECRET, HUB_VAPID_SUBJECT: 'http://example.com' }, /mailto: or https:/],
		['a bare-address subject', { HUB_VAPID_PUBLIC: KEY, HUB_VAPID_PRIVATE: SECRET, HUB_VAPID_SUBJECT: 'me@example.com' }, /mailto: or https:/],
		['a public key of the wrong length', { HUB_VAPID_PUBLIC: 'abc', HUB_VAPID_PRIVATE: SECRET, HUB_VAPID_SUBJECT: SUBJECT }, /HUB_VAPID_PUBLIC is not a VAPID/],
		['a private key of the wrong length', { HUB_VAPID_PUBLIC: KEY, HUB_VAPID_PRIVATE: KEY, HUB_VAPID_SUBJECT: SUBJECT }, /HUB_VAPID_PRIVATE is not a VAPID/]
	])('rejects %s with a clear problem', (_, env, problem) => {
		const cfg = readPushConfig(env);
		expect(cfg.state).toBe('invalid');
		expect(cfg.state === 'invalid' && cfg.problem).toMatch(problem);
	});
});

describe('pushStatus', () => {
	it('gives the public key when configured', () => {
		expect(pushStatus(readPushConfig({ HUB_VAPID_PUBLIC: KEY, HUB_VAPID_PRIVATE: SECRET, HUB_VAPID_SUBJECT: SUBJECT }))).toEqual({ configured: true, publicKey: KEY });
	});

	it('says why in words when unset or mistaken', () => {
		expect(pushStatus({ state: 'off' })).toMatchObject({ configured: false, reason: expect.stringContaining('HUB_VAPID_PUBLIC') });
		expect(pushStatus({ state: 'invalid', problem: 'fix it' })).toEqual({ configured: false, reason: 'fix it' });
	});

	it('logs a mistake as an error and plain off as information', () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		announcePush({ state: 'invalid', problem: 'fix it' });
		expect(err).toHaveBeenCalledWith(expect.stringContaining('fix it'));
		announcePush({ state: 'off' });
		expect(log).toHaveBeenCalledWith(expect.stringContaining('push is off'));
		vi.restoreAllMocks();
	});
});

describe('devices', () => {
	let root: string;
	let vault: Vault;
	const stored = () => readFile(join(root, '_hub/.state/push.json'), 'utf8');

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'prosoche-notify-'));
		vault = new Vault(root);
	});
	afterEach(() => {
		vi.restoreAllMocks();
		return rm(root, { recursive: true, force: true });
	});

	it('starts empty, and subscribing twice keeps one entry with the first time', async () => {
		expect(await devices(vault)).toEqual([]);
		expect(await subscribe(vault, sub(1), 'Chrome on Android', new Date('2026-10-23T09:00:00Z'))).toEqual({ ok: true });
		expect(await subscribe(vault, sub(1), '  Pixel   phone ', new Date('2026-10-24T09:00:00Z'))).toEqual({ ok: true });
		expect(await devices(vault)).toEqual([{ endpoint: sub(1).endpoint, label: 'Pixel phone', addedAt: '2026-10-23T09:00:00.000Z' }]);
	});

	it('never shows keys, and lists devices in the order they joined', async () => {
		await subscribe(vault, sub(1), 'a');
		await subscribe(vault, sub(2), '');
		const list = await devices(vault);
		expect(list.map((d) => d.label)).toEqual(['a', 'Unknown device']);
		expect(JSON.stringify(list)).not.toContain('p256dh');
		expect(await stored()).toContain('p256dh');
	});

	it('keeps both of two devices that subscribe at once', async () => {
		await Promise.all([subscribe(vault, sub(1), 'a'), subscribe(vault, sub(2), 'b')]);
		expect(await devices(vault)).toHaveLength(2);
	});

	it.each([
		['null', null],
		['a string', 'x'],
		['no keys', { endpoint: 'https://push.example.com/x' }],
		['an empty auth', { endpoint: 'https://push.example.com/x', keys: { p256dh: 'abc', auth: '' } }],
		['an http endpoint', { endpoint: 'http://push.example.com/x', keys: sub(1).keys }],
		['an endpoint that is not a url', { endpoint: 'nope', keys: sub(1).keys }],
		['a localhost endpoint', { endpoint: 'https://localhost/x', keys: sub(1).keys }],
		['an ip endpoint', { endpoint: 'https://10.0.0.5/x', keys: sub(1).keys }]
	])('refuses %s with a reason and stores nothing', async (_, bad) => {
		expect(await subscribe(vault, bad, 'x')).toMatchObject({ ok: false, reason: 'invalid', message: expect.any(String) });
		expect(await devices(vault)).toEqual([]);
	});

	it('unsubscribes one device, and an unknown one is not an error', async () => {
		await subscribe(vault, sub(1), 'a');
		await subscribe(vault, sub(2), 'b');
		expect(await unsubscribe(vault, sub(1).endpoint)).toEqual({ ok: true });
		expect(await unsubscribe(vault, 'https://push.example.com/none')).toEqual({ ok: true });
		expect((await devices(vault)).map((d) => d.label)).toEqual(['b']);
	});

	it('reads an unreadable state file as no devices, and says so', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		await vault.write('_hub/.state/push.json', '{nope');
		expect(await devices(vault)).toEqual([]);
		expect(err).toHaveBeenCalled();
	});

	describe('send', () => {
		it('sends the payload to every device with a short life and high urgency', async () => {
			await subscribe(vault, sub(1), 'a');
			await subscribe(vault, sub(2), 'b');
			const sender = vi.fn<Sender>(async () => ({}));
			expect(await send(vault, NOTE, sender)).toEqual({ sent: 2, failed: 0, removed: 0 });
			expect(sender).toHaveBeenCalledTimes(2);
			const [target, payload, options] = sender.mock.calls[0];
			expect(target).toEqual(sub(1));
			expect(JSON.parse(payload)).toEqual(NOTE);
			expect(options).toEqual({ TTL: 600, urgency: 'high' });
		});

		it('removes a device that answers 404 or 410, and keeps the rest', async () => {
			for (const n of [1, 2, 3]) await subscribe(vault, sub(n), `d${n}`);
			const sender: Sender = async (s) => {
				if (s.endpoint.endsWith('/1')) throw Object.assign(new Error('gone'), { statusCode: 410 });
				if (s.endpoint.endsWith('/2')) throw Object.assign(new Error('missing'), { statusCode: 404 });
			};
			expect(await send(vault, NOTE, sender)).toEqual({ sent: 1, failed: 0, removed: 2 });
			expect((await devices(vault)).map((d) => d.label)).toEqual(['d3']);
		});

		it('logs any other failure, counts it, keeps the device and does not retry', async () => {
			const err = vi.spyOn(console, 'error').mockImplementation(() => {});
			await subscribe(vault, sub(1), 'Pixel');
			const sender = vi.fn<Sender>(async () => {
				throw Object.assign(new Error('busy'), { statusCode: 503 });
			});
			expect(await send(vault, NOTE, sender)).toEqual({ sent: 0, failed: 1, removed: 0 });
			expect(sender).toHaveBeenCalledTimes(1);
			expect(err).toHaveBeenCalledWith(expect.stringContaining('Pixel'));
			expect(await devices(vault)).toHaveLength(1);
		});

		it('does nothing with no devices', async () => {
			const sender = vi.fn<Sender>();
			expect(await send(vault, NOTE, sender)).toEqual({ sent: 0, failed: 0, removed: 0 });
			expect(sender).not.toHaveBeenCalled();
		});

		it('counts every device failed, and logs why, when push is unconfigured and no sender is given', async () => {
			const err = vi.spyOn(console, 'error').mockImplementation(() => {});
			await subscribe(vault, sub(1), 'a');
			expect(await send(vault, NOTE)).toEqual({ sent: 0, failed: 1, removed: 0 });
			expect(err).toHaveBeenCalledWith(expect.stringContaining('not sent'));
		});

		it.each(['https://evil.example/x', '//evil.example', 'today'])('refuses the url %s, which is not a path on this app', async (url) => {
			await expect(send(vault, { ...NOTE, url }, async () => ({}))).rejects.toThrow(/path/);
		});
	});
});
