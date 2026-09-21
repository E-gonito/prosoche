/**
 * The `linear` widget: the user's unfinished Linear issues.
 *
 * The mirror of the `github` widget, deliberately: both return the same shape
 * so one component renders either, and the only provider-specific knowledge
 * in the app stays inside `$server/integrations/`.
 */

import { linearFeed } from '../integrations/linear';
import type { IntegrationWidget } from '$lib/shared/integrations';
import type { WidgetContext } from '../widgets';

export async function load(ctx: WidgetContext): Promise<IntegrationWidget> {
	return { feed: await linearFeed(), slug: ctx.workspace?.slug ?? '' };
}
