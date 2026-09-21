/**
 * What an integration returns, known to both sides.
 *
 * GitHub speaks REST and Linear speaks GraphQL, and neither JSON shape appears
 * anywhere outside its own module in `$server/integrations/`. What crosses the
 * boundary is this: a list of work items and one status. A widget renders the
 * same markup for both providers, and adding a third provider means adding a
 * module, not teaching the browser another API.
 *
 * The status is a state, not an exception. No token, a rejected token, a repo
 * the token cannot see, a rate limit and a dead network are all things the
 * card must say out loud, so they are all values.
 */

export type IntegrationProvider = 'github' | 'linear';

/** Why a row is worth noticing. */
export type IntegrationFlag = 'review-requested' | 'draft' | 'in-progress';

export interface IntegrationItem {
	/** Unique within a provider, used as a list key. */
	id: string;
	kind: 'issue' | 'pull';
	/** How the provider names it: `#2097` on GitHub, `ENG-42` on Linear. */
	ref: string;
	title: string;
	url: string;
	/** Where it lives: `atlas/data-portal`, or a Linear team key. */
	context: string;
	/** Workflow state in the provider's own words: `open`, `In Progress`. */
	state: string;
	/** ISO 8601, as the provider gave it. */
	updatedAt: string;
	flags: IntegrationFlag[];
}

export type IntegrationStatus =
	| { state: 'ok' }
	/** No token is configured. The normal case, and the one that ships. */
	| { state: 'not-connected'; message: string }
	/** A token exists but may not see this. Wrong scopes, or a private repo. */
	| { state: 'denied'; message: string }
	| { state: 'rate-limited'; message: string; until: string | null }
	/** Offline, DNS, timeout, or the provider answering with nonsense. */
	| { state: 'unreachable'; message: string };

/** One environment variable, so the card can tell the user what to set. */
export interface EnvSetting {
	name: string;
	required: boolean;
	/** One line: what it is and where to get it. */
	note: string;
}

export interface IntegrationFeed {
	provider: IntegrationProvider;
	/** Display name, so a component never maps provider ids to words. */
	label: string;
	/** What was asked for: the repo filter, or the Linear account. */
	scope: string;
	items: IntegrationItem[];
	status: IntegrationStatus;
	/** Every variable this provider reads, whether or not it is set. */
	env: EnvSetting[];
	/** Epoch ms of the response the items came from; null when never fetched. */
	fetchedAt: number | null;
	/** True when the items came from the short-lived cache, not the network. */
	cached: boolean;
}

/**
 * What the `github` and `linear` widgets hand their component: one feed and
 * the workspace a card made from a row would belong to.
 */
export interface IntegrationWidget {
	feed: IntegrationFeed;
	/** Workspace slug, empty on a page that has no workspace. */
	slug: string;
}

/**
 * The words a card made from this issue should carry: the title, and the
 * reference as a markdown link so the URL travels with the card without
 * burying it.
 *
 * Pure. A title spanning several lines is collapsed onto one, because a task
 * is a line and a newline here would split the card in two; a title that is
 * only whitespace falls back to the reference, so a card is never nameless.
 */
export function issueCardText(item: Pick<IntegrationItem, 'ref' | 'title' | 'url'>): string {
	const title = item.title.replace(/\s+/g, ' ').trim() || item.ref;
	return `${title} [${item.ref}](${item.url})`;
}

/**
 * The whole task line a card made from this issue should be.
 *
 * Pure: text in, text out, no vault access. The grammar is the vault's own —
 * a checkbox, the words, the quadrant as inline code, the workspace tag.
 *
 * Writing a card into a workspace's deck is `$server/cards`, which composes
 * the identical line from `issueCardText` and the workspace; this function is
 * the tested statement of what that line is, and it is what the widget puts on
 * the clipboard when there is no workspace to write to. `slug` empty leaves
 * the tag off rather than writing `#ws/`.
 */
export function issueCardLine(item: Pick<IntegrationItem, 'ref' | 'title' | 'url'>, slug: string, quadrant = 2): string {
	const tag = slug.trim() ? ` #ws/${slug.trim()}` : '';
	return `- [ ] ${issueCardText(item)} \`Q${quadrant}\`${tag}`;
}
