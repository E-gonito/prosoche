import { describe, it, expect } from 'vitest';
import { githubFeed } from './github';
import { issueCardLine } from '$lib/shared/integrations';
import { parseTaskLine, rewriteTaskLine } from '../parse/task';

/**
 * A stub GitHub. Each call records the URL it was asked for and answers with
 * the next scripted reply, so a test can assert on the search grammar as well
 * as on what came back.
 */
function stub(replies: Array<{ body?: unknown; status?: number; headers?: Record<string, string>; throws?: string }>) {
	const calls: string[] = [];
	let n = 0;
	const fetch = (async (url: string | URL) => {
		calls.push(String(url));
		const reply = replies[Math.min(n++, replies.length - 1)];
		if (reply.throws) throw new Error(reply.throws);
		return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? { items: [] }), {
			status: reply.status ?? 200,
			headers: reply.headers
		});
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}

const issue = (over: Record<string, unknown> = {}) => ({
	id: 1,
	number: 2097,
	title: 'PDF export drops the last page',
	html_url: 'https://github.com/atlas/data-portal/issues/2097',
	repository_url: 'https://api.github.com/repos/atlas/data-portal',
	state: 'open',
	updated_at: '2026-09-20T10:00:00Z',
	...over
});

/** Every test uses its own token, so one test's cache is not another's. */
const deps = (fetch: typeof globalThis.fetch, token: string, extra = {}) => ({ fetch, token, api: 'https://stub', cacheTtlMs: 0, ...extra });

describe('githubFeed without a token', () => {
	it('says it is not connected and does not call GitHub', async () => {
		const { fetch, calls } = stub([{}]);
		const feed = await githubFeed({ fetch, token: '  ' });
		expect(feed.status).toEqual({
			state: 'not-connected',
			message: 'No GitHub token is set, so the hub is not asking GitHub anything.'
		});
		expect(calls).toEqual([]);
		expect(feed.items).toEqual([]);
		expect(feed.fetchedAt).toBe(null);
	});

	it('still names the variables to set, since that is the whole card', async () => {
		const feed = await githubFeed({ token: '' });
		expect(feed.env.map((e) => [e.name, e.required])).toEqual([
			['HUB_GITHUB_TOKEN', true],
			['HUB_GITHUB_REPOS', false]
		]);
	});
});

describe('githubFeed with a token', () => {
	it('asks for open work assigned to the user and for reviews waiting on them', async () => {
		const { fetch, calls } = stub([{ body: { items: [] } }]);
		await githubFeed(deps(fetch, 'tok-queries'));
		expect(calls).toHaveLength(2);
		expect(decodeURIComponent(calls[0])).toContain('q=is:open assignee:@me');
		expect(decodeURIComponent(calls[1])).toContain('q=is:open is:pr review-requested:@me');
	});

	it('narrows to the configured repos', async () => {
		const { fetch, calls } = stub([{ body: { items: [] } }]);
		await githubFeed(deps(fetch, 'tok-repos', { repos: ['atlas/data-portal', 'atlas/website'] }));
		expect(decodeURIComponent(calls[0])).toContain('repo:atlas/data-portal repo:atlas/website');
	});

	it('turns the response into neutral items, telling issues from pull requests', async () => {
		const { fetch } = stub([
			{ body: { items: [issue(), issue({ id: 2, number: 12, pull_request: { url: 'x' }, draft: true, title: 'Tidy the import path' })] } },
			{ body: { items: [] } }
		]);
		const feed = await githubFeed(deps(fetch, 'tok-map'));
		expect(feed.status).toEqual({ state: 'ok' });
		expect(feed.items.map((i) => [i.kind, i.ref, i.context, i.flags])).toEqual([
			['issue', '#2097', 'atlas/data-portal', []],
			['pull', '#12', 'atlas/data-portal', ['draft']]
		]);
		expect(feed.items[0].url).toBe('https://github.com/atlas/data-portal/issues/2097');
	});

	it('counts a row returned by both searches once, with both flags', async () => {
		const pull = issue({ id: 9, number: 40, pull_request: { url: 'x' } });
		const { fetch } = stub([{ body: { items: [pull] } }, { body: { items: [pull] } }]);
		const feed = await githubFeed(deps(fetch, 'tok-dedupe'));
		expect(feed.items).toHaveLength(1);
		expect(feed.items[0].flags).toEqual(['review-requested']);
	});

	it('puts a review someone is waiting on above everything else', async () => {
		const mine = issue({ id: 1, number: 1, updated_at: '2026-09-21T09:00:00Z' });
		const review = issue({ id: 2, number: 2, pull_request: { url: 'x' }, updated_at: '2026-01-01T09:00:00Z' });
		const { fetch } = stub([{ body: { items: [mine, review] } }, { body: { items: [review] } }]);
		const feed = await githubFeed(deps(fetch, 'tok-order'));
		expect(feed.items.map((i) => i.ref)).toEqual(['#2', '#1']);
	});
});

describe('githubFeed when GitHub says no', () => {
	const cases: Array<[string, Parameters<typeof stub>[0][number], string]> = [
		['a rejected token', { status: 401 }, 'denied'],
		['a token without the permission', { status: 403 }, 'denied'],
		['a repo the token cannot see', { status: 404 }, 'denied'],
		['a rate limit', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }, 'rate-limited'],
		['too many requests', { status: 429 }, 'rate-limited'],
		['an unexpected code', { status: 500 }, 'unreachable'],
		['a dead network', { throws: 'getaddrinfo ENOTFOUND' }, 'unreachable'],
		['a reply that is not JSON', { body: '<html>502</html>' }, 'unreachable']
	];

	for (const [name, reply, expected] of cases) {
		it(`renders ${name} as ${expected} rather than throwing`, async () => {
			const { fetch } = stub([reply]);
			const feed = await githubFeed(deps(fetch, `tok-${expected}-${name}`));
			expect(feed.status.state).toBe(expected);
			expect(feed.status.state === 'ok' ? '' : feed.status.message).toMatch(/GitHub|token|repos/);
			expect(feed.items).toEqual([]);
		});
	}

	it('says when the rate limit lifts, when GitHub tells it', async () => {
		const reset = Math.floor(Date.UTC(2026, 8, 21, 18, 0, 0) / 1000);
		const { fetch } = stub([{ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } }]);
		const feed = await githubFeed(deps(fetch, 'tok-reset'));
		expect(feed.status).toMatchObject({ state: 'rate-limited', until: '2026-09-21T18:00:00.000Z' });
	});
});

describe('githubFeed caching', () => {
	it('serves a second load from memory, then goes back after the window', async () => {
		const { fetch, calls } = stub([{ body: { items: [issue()] } }]);
		let clock = 1_000_000;
		const shared = { fetch, token: 'tok-cache', api: 'https://stub', cacheTtlMs: 60_000, now: () => clock };

		const first = await githubFeed(shared);
		expect(first.cached).toBe(false);
		expect(calls).toHaveLength(2);

		clock += 30_000;
		const second = await githubFeed(shared);
		expect(second.cached).toBe(true);
		expect(second.items).toEqual(first.items);
		expect(calls).toHaveLength(2);

		clock += 60_000;
		const third = await githubFeed(shared);
		expect(third.cached).toBe(false);
		expect(calls).toHaveLength(4);
	});

	it('does not cache a failure as if it were an answer', async () => {
		const { fetch, calls } = stub([{ status: 500 }]);
		const shared = { fetch, token: 'tok-nocache-fail', api: 'https://stub', cacheTtlMs: 60_000, now: () => 5 };
		await githubFeed(shared);
		await githubFeed(shared);
		expect(calls).toHaveLength(2);
	});
});

describe('the card line an issue becomes', () => {
	it('parses back as a task with the quadrant and workspace tag intact', () => {
		const line = issueCardLine({ ref: '#2097', title: 'PDF export drops the last page', url: 'https://github.com/e/d/issues/2097' }, 'atlas');
		const task = parseTaskLine(line, 0);
		expect(task).not.toBe(null);
		expect(task?.status).toBe('todo');
		expect(task?.quadrant).toBe(2);
		expect(task?.tags).toEqual(['ws/atlas']);
		expect(task?.text).toContain('PDF export drops the last page');
		// The board's own writer appends it; this module only says what to write.
		expect(rewriteTaskLine(line, {})).toBe(line);
	});
});
