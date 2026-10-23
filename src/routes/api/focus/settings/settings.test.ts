import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '$server/vault/index';

let vault: Vault;
vi.mock('$server/hub', () => ({ hub: async () => ({ vault }) }));

const { POST } = await import('./+server');

async function post(body: object) {
	const request = new Request('http://x/api/focus/settings', { method: 'POST', body: JSON.stringify(body) });
	const res = (await POST({ request, url: new URL(request.url), params: {} } as never)) as Response;
	return { status: res.status, body: await res.json() };
}

describe('/api/focus/settings', () => {
	let root: string;
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'prosoche-focus-api-'));
		vault = new Vault(root);
	});
	afterEach(() => rm(root, { recursive: true, force: true }));

	it('saves a patch and answers the settings as written', async () => {
		const res = await post({ windDownMin: 15, planBy: '09:30' });
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ ok: true, warmupMin: 5, planByMin: 570, rules: { windDownMin: 15 } });
	});

	it('refuses a value out of range in words', async () => {
		const res = await post({ warmupMin: 0 });
		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/1 to 60/);
	});
});
