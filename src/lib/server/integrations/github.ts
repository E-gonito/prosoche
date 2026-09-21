/**
 * GitHub: the open issues and pull requests waiting on the user.
 *
 * Everything GitHub-shaped lives here — the endpoint, the search grammar, the
 * `Authorization` header, the JSON field names and the meaning of each status
 * code. Callers get an `IntegrationFeed` and never learn that GitHub has a
 * `repository_url` or that a pull request is an issue with a `pull_request`
 * key hanging off it.
 *
 * Two searches are issued rather than one, because "assigned to me" and
 * "waiting on my review" are different questions with the same answer shape,
 * and the second is the one the user actually opens GitHub for. A row that
 * comes back from both is one row with both flags.
 *
 * Failure is never thrown. A missing token, a rejected token, a repo the token
 * cannot see, a rate limit and a dead network are five statuses the card can
 * render, and the first of those is the state this ships in.
 */

import { config } from '../config';
import type { EnvSetting, IntegrationFeed, IntegrationFlag, IntegrationItem, IntegrationStatus } from '$lib/shared/integrations';

export interface GithubDeps {
	/** Overrides `HUB_GITHUB_TOKEN`. Empty or absent means not connected. */
	token?: string;
	/** `owner/name` list. Empty means every repo the token can see. */
	repos?: readonly string[];
	/** API root, so a test can answer instead of github.com. */
	api?: string;
	fetch?: typeof globalThis.fetch;
	now?: () => number;
	/** 0 disables the cache, which is what a test wants. */
	cacheTtlMs?: number;
}

/** What to set to connect GitHub, shown verbatim on the not-connected card. */
export const GITHUB_ENV: EnvSetting[] = [
	{
		name: 'HUB_GITHUB_TOKEN',
		required: true,
		note: 'A GitHub token with read access to issues and pull requests. A fine-grained token needs Issues: read and Pull requests: read on the repos you care about.'
	},
	{
		name: 'HUB_GITHUB_REPOS',
		required: false,
		note: 'Comma-separated owner/name list to narrow the search, e.g. atlas/data-portal. Leave unset to see everything the token can.'
	}
];

/** How many rows a card can usefully show before it becomes a list page. */
const LIMIT = 20;

const cache = new Map<string, { at: number; feed: IntegrationFeed }>();

/**
 * Fetch the user's open GitHub work.
 *
 * Returns a feed whose `status` says whether the items are real. Results are
 * cached in this process for `cacheTtlMs`, so several widgets on one page
 * share a single round trip; the cached copy is marked as such. Never writes
 * anything, never throws, and never sends the token anywhere but `api`.
 */
export async function githubFeed(deps: GithubDeps = {}): Promise<IntegrationFeed> {
	const token = (deps.token ?? config.github.token).trim();
	const repos = deps.repos ?? config.github.repos;
	const api = (deps.api ?? config.github.api).replace(/\/$/, '');
	const ttl = deps.cacheTtlMs ?? config.github.cacheTtlMs;
	const now = deps.now ?? Date.now;
	const doFetch = deps.fetch ?? globalThis.fetch;
	const scope = repos.length ? repos.join(', ') : 'every repo your token can see';

	if (!token) {
		return feed({
			scope,
			status: {
				state: 'not-connected',
				message: 'No GitHub token is set, so the hub is not asking GitHub anything.'
			}
		});
	}

	const key = `${api}|${token}|${repos.join(',')}`;
	const hit = cache.get(key);
	if (ttl > 0 && hit && now() - hit.at < ttl) return { ...hit.feed, cached: true };

	const filter = repos.map((repo) => ` repo:${repo}`).join('');
	const searches = [
		{ q: `is:open assignee:@me${filter}`, flag: null as IntegrationFlag | null },
		{ q: `is:open is:pr review-requested:@me${filter}`, flag: 'review-requested' as IntegrationFlag }
	];

	const byId = new Map<string, IntegrationItem>();
	let fetchedAt = now();
	for (const search of searches) {
		const answer = await search1(doFetch, api, token, search.q);
		if ('status' in answer) return feed({ scope, status: answer.status });
		fetchedAt = now();
		for (const item of answer.items) {
			const flags = search.flag ? merge(item.flags, [search.flag]) : item.flags;
			const seen = byId.get(item.id);
			if (seen) seen.flags = merge(seen.flags, flags);
			else byId.set(item.id, { ...item, flags });
		}
	}

	const items = [...byId.values()]
		// A review someone is waiting on outranks anything assigned, then the
		// most recently touched, because that is the one still in the head.
		.sort((a, b) => Number(waiting(b)) - Number(waiting(a)) || b.updatedAt.localeCompare(a.updatedAt))
		.slice(0, LIMIT);

	const result = feed({ scope, status: { state: 'ok' }, items, fetchedAt });
	if (ttl > 0) cache.set(key, { at: now(), feed: result });
	return result;
}

const waiting = (item: IntegrationItem) => item.flags.includes('review-requested');

const merge = (a: IntegrationFlag[], b: IntegrationFlag[]) => [...new Set([...a, ...b])];

function feed(parts: {
	scope: string;
	status: IntegrationStatus;
	items?: IntegrationItem[];
	fetchedAt?: number;
}): IntegrationFeed {
	return {
		provider: 'github',
		label: 'GitHub',
		scope: parts.scope,
		items: parts.items ?? [],
		status: parts.status,
		env: GITHUB_ENV,
		fetchedAt: parts.fetchedAt ?? null,
		cached: false
	};
}

/** GitHub's issue-search response, named only here. */
interface SearchResponse {
	items?: Array<{
		id?: number;
		number?: number;
		title?: string;
		html_url?: string;
		repository_url?: string;
		state?: string;
		draft?: boolean;
		updated_at?: string;
		pull_request?: { url?: string };
	}>;
}

/** One search, mapped to items or to the status that explains the silence. */
async function search1(
	doFetch: typeof globalThis.fetch,
	api: string,
	token: string,
	q: string
): Promise<{ items: IntegrationItem[] } | { status: IntegrationStatus }> {
	const url = `${api}/search/issues?per_page=${LIMIT}&sort=updated&order=desc&q=${encodeURIComponent(q)}`;
	let response: Response;
	try {
		response = await doFetch(url, {
			headers: {
				accept: 'application/vnd.github+json',
				authorization: `Bearer ${token}`,
				'x-github-api-version': '2022-11-28'
			}
		});
	} catch (e) {
		return { status: { state: 'unreachable', message: `Could not reach GitHub: ${reason(e)}.` } };
	}

	if (!response.ok) return { status: statusFor(response) };

	let body: SearchResponse;
	try {
		body = (await response.json()) as SearchResponse;
	} catch {
		return { status: { state: 'unreachable', message: 'GitHub answered with something that was not JSON.' } };
	}
	return { items: (body.items ?? []).map(toItem) };
}

/** What a non-2xx means, in the user's terms rather than in numbers. */
function statusFor(response: Response): IntegrationStatus {
	const remaining = response.headers.get('x-ratelimit-remaining');
	const reset = response.headers.get('x-ratelimit-reset');
	const retryAfter = response.headers.get('retry-after');

	if (response.status === 429 || (response.status === 403 && remaining === '0')) {
		return {
			state: 'rate-limited',
			message: 'GitHub is rate limiting this token. The hub will try again on the next load.',
			until: resetTime(reset, retryAfter)
		};
	}
	if (response.status === 401) {
		return { state: 'denied', message: 'GitHub rejected the token. It may have expired or been revoked.' };
	}
	if (response.status === 403) {
		return { state: 'denied', message: 'The token is not allowed to search issues. Check its Issues and Pull requests permissions.' };
	}
	if (response.status === 404) {
		return { state: 'denied', message: 'GitHub cannot see one of the repos in HUB_GITHUB_REPOS with this token.' };
	}
	return { state: 'unreachable', message: `GitHub answered ${response.status}.` };
}

function resetTime(reset: string | null, retryAfter: string | null): string | null {
	if (reset && /^\d+$/.test(reset)) return new Date(Number(reset) * 1000).toISOString();
	if (retryAfter && /^\d+$/.test(retryAfter)) return new Date(Date.now() + Number(retryAfter) * 1000).toISOString();
	return null;
}

function toItem(raw: NonNullable<SearchResponse['items']>[number]): IntegrationItem {
	const pull = Boolean(raw.pull_request);
	const repo = (raw.repository_url ?? '').replace(/^.*\/repos\//, '');
	const number = raw.number ?? 0;
	const flags: IntegrationFlag[] = raw.draft ? ['draft'] : [];
	return {
		id: `github:${raw.id ?? `${repo}#${number}`}`,
		kind: pull ? 'pull' : 'issue',
		ref: `#${number}`,
		title: raw.title ?? '(untitled)',
		url: raw.html_url ?? '',
		context: repo,
		state: raw.state ?? 'open',
		updatedAt: raw.updated_at ?? '',
		flags
	};
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
