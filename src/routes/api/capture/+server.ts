import { capture } from '$server/capture';
import { isDayKey } from '$server/daily';
import { noWorkspace, refuse, route, str } from '../route';

/**
 * Capture `{ text }`, wherever its words send it (see `capture.ts`); with
 * `workspace` (a slug) into the inbox tagged for that workspace; or with
 * `day` (`YYYY-MM-DD`, the box on that day's Unscheduled list) into that
 * day's note as a task. Answers `{ path, to, message }`: the file written,
 * which of the three places it was, and the sentence to show. An unknown
 * workspace or a malformed day is refused rather than sent somewhere else,
 * so a typo never lands where the user did not point it.
 */
export const POST = route<{ text: string; workspace: string; day: string }>(async ({ body, hub }) => {
	const text = str(body.text);
	if (!text?.trim()) return refuse('no-text', 'Nothing to capture.');
	const workspace = body.workspace ? await hub.workspace(body.workspace) : undefined;
	if (body.workspace && !workspace) return noWorkspace(body.workspace);
	const day = str(body.day);
	if (day && !isDayKey(day)) return refuse('bad-day');
	return capture(hub.vault, await hub.workspaces(), text, { workspace: workspace ?? undefined, day: day || undefined });
});
