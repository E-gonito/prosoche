import { describe, it, expect } from 'vitest';
import { linearFeed } from './linear';

/** A stub Linear, recording the request bodies so the query can be asserted. */
function stub(replies: Array<{ body?: unknown; status?: number; headers?: Record<string, string>; throws?: string }>) {
	const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
	let n = 0;
	const fetch = (async (url: string | URL, init?: RequestInit) => {
		calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? '') });
		const reply = replies[Math.min(n++, replies.length - 1)];
		if (reply.throws) throw new Error(reply.throws);
		return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {}), {
			status: reply.status ?? 200,
			headers: reply.headers
		});
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}

const node = (over: Record<string, unknown> = {}) => ({
	id: 'uuid-1',
	identifier: 'ENG-42',
	title: 'Tidy the import path at the byte level',
	url: 'https://linear.app/atlas/issue/ENG-42',
	updatedAt: '2026-09-20T10:00:00Z',
	state: { name: 'Todo', type: 'unstarted' },
	team: { key: 'ENG' },
	...over
});

const viewer = (nodes: unknown[]) => ({
	data: { viewer: { name: 'Alex', organization: { name: 'Atlas' }, assignedIssues: { nodes } } }
});

const deps = (fetch: typeof globalThis.fetch, token: string) => ({ fetch, token, api: 'https://stub/graphql', cacheTtlMs: 0 });

describe('linearFeed without a key', () => {
	it('says it is not connected and does not call Linear', async () => {
		const { fetch, calls } = stub([{}]);
		const feed = await linearFeed({ fetch, token: '' });
		expect(feed.status).toEqual({
			state: 'not-connected',
			message: 'No Linear API key is set, so the hub is not asking Linear anything.'
		});
		expect(calls).toEqual([]);
	});

	it('names the one variable that would connect it', async () => {
		const feed = await linearFeed({ token: '' });
		expect(feed.env.map((e) => e.name)).toEqual(['HUB_LINEAR_TOKEN']);
		expect(feed.env[0].note).toContain('Personal API keys');
	});
});

describe('linearFeed with a key', () => {
	it('sends the key as-is, not as a bearer token, and asks for unfinished work', async () => {
		const { fetch, calls } = stub([{ body: viewer([]) }]);
		await linearFeed(deps(fetch, 'lin_key_1'));
		expect(calls[0].headers.authorization).toBe('lin_key_1');
		expect(calls[0].body).toContain('assignedIssues');
		expect(calls[0].body).toContain('completed');
		expect(calls[0].body).toContain('canceled');
	});

	it('turns the nodes into neutral items', async () => {
		const { fetch } = stub([{ body: viewer([node(), node({ id: 'uuid-2', identifier: 'ENG-43', state: { name: 'In Progress', type: 'started' } })]) }]);
		const feed = await linearFeed(deps(fetch, 'lin_key_2'));
		expect(feed.status).toEqual({ state: 'ok' });
		expect(feed.items.map((i) => [i.ref, i.kind, i.context, i.state, i.flags])).toEqual([
			['ENG-42', 'issue', 'ENG', 'Todo', []],
			['ENG-43', 'issue', 'ENG', 'In Progress', ['in-progress']]
		]);
		expect(feed.scope).toBe('Atlas, assigned to Alex');
	});

	it('survives a node missing half its fields', async () => {
		const { fetch } = stub([{ body: viewer([{ identifier: 'ENG-1' }]) }]);
		const feed = await linearFeed(deps(fetch, 'lin_key_3'));
		expect(feed.items[0]).toMatchObject({ ref: 'ENG-1', title: '(untitled)', state: 'Open', context: '' });
	});
});

describe('linearFeed when Linear says no', () => {
	const cases: Array<[string, Parameters<typeof stub>[0][number], string]> = [
		['a rejected key', { status: 401 }, 'denied'],
		['a forbidden key', { status: 403 }, 'denied'],
		['a query it will not run', { status: 400 }, 'denied'],
		['a rate limit', { status: 429 }, 'rate-limited'],
		['an unexpected code', { status: 502 }, 'unreachable'],
		['a dead network', { throws: 'fetch failed' }, 'unreachable'],
		['a reply that is not JSON', { body: 'nope' }, 'unreachable']
	];

	for (const [name, reply, expected] of cases) {
		it(`renders ${name} as ${expected} rather than throwing`, async () => {
			const { fetch } = stub([reply]);
			const feed = await linearFeed(deps(fetch, `lin-${expected}-${name}`));
			expect(feed.status.state).toBe(expected);
			expect(feed.items).toEqual([]);
		});
	}

	it('reads a GraphQL error inside a 200, which is how Linear reports most of them', async () => {
		const { fetch } = stub([{ body: { errors: [{ message: 'Authentication required' }] } }]);
		const feed = await linearFeed(deps(fetch, 'lin-graphql-error'));
		expect(feed.status).toEqual({ state: 'denied', message: 'Linear refused the query: Authentication required' });
	});

	it('treats a null viewer as a key it does not recognise', async () => {
		const { fetch } = stub([{ body: { data: { viewer: null } } }]);
		const feed = await linearFeed(deps(fetch, 'lin-null-viewer'));
		expect(feed.status).toEqual({ state: 'denied', message: 'Linear did not recognise the API key.' });
	});
});

describe('linearFeed caching', () => {
	it('serves a second load from memory, then goes back after the window', async () => {
		const { fetch, calls } = stub([{ body: viewer([node()]) }]);
		let clock = 500;
		const shared = { fetch, token: 'lin-cache', api: 'https://stub/graphql', cacheTtlMs: 60_000, now: () => clock };

		expect((await linearFeed(shared)).cached).toBe(false);
		clock += 1000;
		expect((await linearFeed(shared)).cached).toBe(true);
		expect(calls).toHaveLength(1);

		clock += 60_000;
		expect((await linearFeed(shared)).cached).toBe(false);
		expect(calls).toHaveLength(2);
	});
});
