/**
 * The `github` widget: open issues and pull requests waiting on the user.
 *
 * The fetching, the caching and the failure states are in
 * `$server/integrations/github`. What this adds is the workspace the tab
 * belongs to, which is what a card made from an issue needs to be tagged
 * with, and it is the reason the widget data is not just the feed.
 *
 * Never throws: the integration reports trouble as a status, and a card that
 * says why it is empty is worth more than a tab that fails to render.
 */

import { githubFeed } from '../integrations/github';
import type { IntegrationWidget } from '$lib/shared/integrations';
import type { WidgetContext } from '../widgets';

export async function load(ctx: WidgetContext): Promise<IntegrationWidget> {
	return { feed: await githubFeed(), slug: ctx.workspace?.slug ?? '' };
}
