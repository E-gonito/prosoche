/**
 * Linear: the issues assigned to the user that are not finished.
 *
 * Linear has one endpoint and one GraphQL document, both of which live here.
 * The query asks the API who the token belongs to and what is assigned to
 * them in the same round trip, so the hub never has to know or store a user
 * id. Completed and cancelled states are filtered by Linear rather than by
 * the hub, because "done" is a per-workspace notion the API already models.
 *
 * As with GitHub, nothing throws: a missing key, a rejected key, a rate limit
 * and an unreachable API are statuses the card renders. The shapes crossing
 * out of this file are the neutral ones in `$lib/shared/integrations`, so no
 * component has ever heard of a GraphQL envelope.
 */

import { config } from '../config';
import type { EnvSetting, IntegrationFeed, IntegrationFlag, IntegrationItem, IntegrationStatus } from '$lib/shared/integrations';

export interface LinearDeps {
	/** Overrides `HUB_LINEAR_TOKEN`. Empty or absent means not connected. */
	token?: string;
	/** Endpoint, so a test can answer instead of linear.app. */
	api?: string;
	fetch?: typeof globalThis.fetch;
	now?: () => number;
	/** 0 disables the cache, which is what a test wants. */
	cacheTtlMs?: number;
}

/** What to set to connect Linear, shown verbatim on the not-connected card. */
export const LINEAR_ENV: EnvSetting[] = [
	{
		name: 'HUB_LINEAR_TOKEN',
		required: true,
		note: 'A Linear personal API key from Settings → Security & access → Personal API keys. Read access is enough.'
	}
];

const LIMIT = 20;

/**
 * One request for everything the card shows. `assignedIssues` is already
 * scoped to the token's own user, and the state filter is the API's own
 * notion of unfinished work.
 */
const QUERY = `query HubAssigned($first: Int!) {
  viewer {
    name
    organization { name }
    assignedIssues(
      first: $first
      orderBy: updatedAt
      filter: { state: { type: { nin: ["completed", "canceled"] } } }
    ) {
      nodes {
        id
        identifier
        title
        url
        updatedAt
        state { name type }
        team { key }
      }
    }
  }
}`;

const cache = new Map<string, { at: number; feed: IntegrationFeed }>();

/**
 * Fetch the user's open Linear issues.
 *
 * Returns a feed whose `status` says whether the items are real, cached in
 * this process for `cacheTtlMs` so a page load does not hit the network every
 * time. Never writes anything, never throws, and never sends the key anywhere
 * but `api`.
 */
export async function linearFeed(deps: LinearDeps = {}): Promise<IntegrationFeed> {
	const token = (deps.token ?? config.linear.token).trim();
	const api = deps.api ?? config.linear.api;
	const ttl = deps.cacheTtlMs ?? config.linear.cacheTtlMs;
	const now = deps.now ?? Date.now;
	const doFetch = deps.fetch ?? globalThis.fetch;

	if (!token) {
		return feed({
			scope: 'your Linear account',
			status: { state: 'not-connected', message: 'No Linear API key is set, so the hub is not asking Linear anything.' }
		});
	}

	const key = `${api}|${token}`;
	const hit = cache.get(key);
	if (ttl > 0 && hit && now() - hit.at < ttl) return { ...hit.feed, cached: true };

	let response: Response;
	try {
		response = await doFetch(api, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: token },
			body: JSON.stringify({ query: QUERY, variables: { first: LIMIT } })
		});
	} catch (e) {
		return feed({
			scope: 'your Linear account',
			status: { state: 'unreachable', message: `Could not reach Linear: ${e instanceof Error ? e.message : String(e)}.` }
		});
	}

	if (!response.ok) return feed({ scope: 'your Linear account', status: statusFor(response) });

	let body: LinearResponse;
	try {
		body = (await response.json()) as LinearResponse;
	} catch {
		return feed({ scope: 'your Linear account', status: { state: 'unreachable', message: 'Linear answered with something that was not JSON.' } });
	}

	// GraphQL reports its own failures inside a 200, so the envelope has to be
	// read even when the transport was happy.
	if (body.errors?.length) {
		const message = body.errors[0]?.message ?? 'Linear refused the query.';
		return feed({ scope: 'your Linear account', status: { state: 'denied', message: `Linear refused the query: ${message}` } });
	}
	const viewer = body.data?.viewer;
	if (!viewer) {
		return feed({ scope: 'your Linear account', status: { state: 'denied', message: 'Linear did not recognise the API key.' } });
	}

	const items = (viewer.assignedIssues?.nodes ?? []).map(toItem);
	const result = feed({
		scope: viewer.organization?.name ? `${viewer.organization.name}, assigned to ${viewer.name ?? 'you'}` : 'your Linear account',
		status: { state: 'ok' },
		items,
		fetchedAt: now()
	});
	if (ttl > 0) cache.set(key, { at: now(), feed: result });
	return result;
}

/** Linear's GraphQL envelope and the one query's shape, named only here. */
interface LinearResponse {
	data?: {
		viewer?: {
			name?: string;
			organization?: { name?: string };
			assignedIssues?: { nodes?: LinearIssue[] };
		} | null;
	};
	errors?: Array<{ message?: string }>;
}

interface LinearIssue {
	id?: string;
	identifier?: string;
	title?: string;
	url?: string;
	updatedAt?: string;
	state?: { name?: string; type?: string };
	team?: { key?: string };
}

function statusFor(response: Response): IntegrationStatus {
	if (response.status === 429) {
		const retryAfter = response.headers.get('retry-after');
		return {
			state: 'rate-limited',
			message: 'Linear is rate limiting this key. The hub will try again on the next load.',
			until: retryAfter && /^\d+$/.test(retryAfter) ? new Date(Date.now() + Number(retryAfter) * 1000).toISOString() : null
		};
	}
	if (response.status === 400 || response.status === 401 || response.status === 403) {
		return { state: 'denied', message: 'Linear rejected the API key. It may have expired or been revoked.' };
	}
	return { state: 'unreachable', message: `Linear answered ${response.status}.` };
}

function toItem(raw: LinearIssue): IntegrationItem {
	const flags: IntegrationFlag[] = raw.state?.type === 'started' ? ['in-progress'] : [];
	return {
		id: `linear:${raw.id ?? raw.identifier ?? raw.url ?? ''}`,
		kind: 'issue',
		ref: raw.identifier ?? '',
		title: raw.title ?? '(untitled)',
		url: raw.url ?? '',
		context: raw.team?.key ?? '',
		state: raw.state?.name ?? 'Open',
		updatedAt: raw.updatedAt ?? '',
		flags
	};
}

function feed(parts: {
	scope: string;
	status: IntegrationStatus;
	items?: IntegrationItem[];
	fetchedAt?: number;
}): IntegrationFeed {
	return {
		provider: 'linear',
		label: 'Linear',
		scope: parts.scope,
		items: parts.items ?? [],
		status: parts.status,
		env: LINEAR_ENV,
		fetchedAt: parts.fetchedAt ?? null,
		cached: false
	};
}
