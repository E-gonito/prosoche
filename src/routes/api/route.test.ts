import { describe, it, expect, vi } from 'vitest';
import { PathOutsideVaultError } from '$server/vault/paths';

const fakeHub = { vault: {}, index: {} };
vi.mock('$server/hub', () => ({ hub: async () => fakeHub }));

const { refuse, route } = await import('./route');

/** Run a wrapped handler the way SvelteKit would, and read back what it answered. */
async function call(handler: Parameters<typeof route>[0], init: { method?: string; body?: string } = {}, words?: Record<string, string>) {
	const request = new Request('http://x/api/thing?q=1', { method: init.method ?? 'POST', body: init.body });
	const event = { request, url: new URL(request.url), params: { day: '2026-09-30' } } as never;
	const res = (await route(handler, words)(event)) as Response;
	return { status: res.status, body: await res.json() };
}

describe('route', () => {
	it('hands the handler the parsed body, the url, the params and the hub', async () => {
		let seen: unknown;
		await call((c) => ((seen = c), {}), { body: '{"a":1}' });
		expect(seen).toMatchObject({ body: { a: 1 }, params: { day: '2026-09-30' }, hub: fakeHub });
		expect((seen as { url: URL }).url.searchParams.get('q')).toBe('1');
	});

	it.each([
		['not JSON', 'nope'],
		['an array', '[1]'],
		['null', 'null'],
		['nothing', undefined]
	])('reads a body that is %s as {}', async (_, body) => {
		let seen: unknown;
		await call((c) => ((seen = c.body), {}), { body });
		expect(seen).toEqual({});
	});

	it('answers 200 with whatever the handler returned when it is not a refusal', async () => {
		expect(await call(() => ({ ok: true, task: 't' }))).toEqual({ status: 200, body: { ok: true, task: 't' } });
		expect(await call(() => ({ hits: [] }))).toEqual({ status: 200, body: { hits: [] } });
	});

	it.each([
		['invalid', 400],
		['no-text', 400],
		['private', 403],
		['not-found', 404],
		['no-note', 404],
		['conflict', 409],
		['line-changed', 409],
		['exists', 409],
		['not-cards', 422]
	])('answers the refusal %s with %i', async (reason, status) => {
		expect((await call(() => refuse(reason))).status).toBe(status);
	});

	it('says why: the refusal’s own message, else the route’s words, else the table’s', async () => {
		expect((await call(() => refuse('exists', 'Mine.'), {}, { exists: 'Route.' })).body.error).toBe('Mine.');
		expect((await call(() => refuse('exists'), {}, { exists: 'Route.' })).body.error).toBe('Route.');
		expect((await call(() => refuse('conflict'))).body.error).toContain('changed somewhere else');
	});

	it('keeps the rest of a refusal, such as the board as it now is', async () => {
		const { body } = await call(() => ({ ok: false, reason: 'conflict', board: { columns: [] } }));
		expect(body).toMatchObject({ ok: false, reason: 'conflict', board: { columns: [] } });
		expect(body.message).toBeUndefined();
	});

	it('answers a path outside the vault with 400 and lets anything else throw', async () => {
		expect((await call(() => { throw new PathOutsideVaultError('../x'); })).status).toBe(400);
		await expect(call(() => { throw new Error('boom'); })).rejects.toThrow('boom');
	});

	it('never reads a body from a GET', async () => {
		let seen: unknown;
		await call((c) => ((seen = c.body), {}), { method: 'GET' });
		expect(seen).toEqual({});
	});
});
