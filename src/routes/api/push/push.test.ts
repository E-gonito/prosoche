import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '$server/vault/index';

let vault: Vault;
let configured = false;
vi.mock('$server/hub', () => ({ hub: async () => ({ vault }) }));
vi.mock('$server/notify', async (original) => {
	const real = await original<typeof import('$server/notify')>();
	return {
		...real,
		pushStatus: () => (configured ? { configured: true, publicKey: 'PUB' } : { configured: false, reason: 'not set up' }),
		send: vi.fn(async () => ({ sent: 1, failed: 0, removed: 0 }))
	};
});

const { GET, POST } = await import('./+server');
const { send } = await import('$server/notify');

const sub = { endpoint: 'https://push.example.com/send/1', keys: { p256dh: 'abc', auth: 'def' } };

async function post(body: object) {
	const request = new Request('http://x/api/push', { method: 'POST', body: JSON.stringify(body) });
	const res = (await POST({ request, url: new URL(request.url), params: {} } as never)) as Response;
	return { status: res.status, body: await res.json() };
}

describe('/api/push', () => {
	let root: string;
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'prosoche-push-'));
		vault = new Vault(root);
		configured = true;
	});
	afterEach(() => rm(root, { recursive: true, force: true }));

	it('subscribes, lists, and unsubscribes', async () => {
		expect((await post({ action: 'subscribe', subscription: sub, label: 'Chrome on Android' })).status).toBe(200);
		const request = new Request('http://x/api/push');
		const listed = await (await GET({ request, url: new URL(request.url), params: {} } as never)).json();
		expect(listed).toEqual({ status: { configured: true, publicKey: 'PUB' }, devices: [{ endpoint: sub.endpoint, label: 'Chrome on Android', addedAt: expect.any(String) }] });
		expect((await post({ action: 'unsubscribe', endpoint: sub.endpoint })).status).toBe(200);
	});

	it('refuses a bad subscription with 400 and a sentence', async () => {
		const res = await post({ action: 'subscribe', subscription: { endpoint: 'x' }, label: 'a' });
		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/push subscription/);
	});

	it('refuses to subscribe or test when push is not configured, saying why', async () => {
		configured = false;
		for (const action of ['subscribe', 'test']) {
			expect(await post({ action, subscription: sub })).toMatchObject({ status: 422, body: { error: 'not set up' } });
		}
	});

	it('sends the test to /today and answers the result', async () => {
		expect(await post({ action: 'test' })).toEqual({ status: 200, body: { sent: 1, failed: 0, removed: 0 } });
		expect(send).toHaveBeenCalledWith(vault, expect.objectContaining({ title: 'Notifications work', url: '/today' }));
	});

	it('refuses an unknown action and an unsubscribe with no endpoint', async () => {
		expect((await post({ action: 'nope' })).status).toBe(400);
		expect((await post({ action: 'unsubscribe' })).status).toBe(400);
	});
});
