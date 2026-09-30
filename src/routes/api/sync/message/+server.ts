import { suggestCommitMessage } from '$server/ai/commit-message';
import { refuse, route, strings } from '../../route';

/**
 * `{ paths }`: a suggested commit message for these pending files, read from
 * their diffs. Answers `{ ok: true, message }`, or `{ ok: false, problem }`
 * with a 200 when the model was off, over budget or answered badly, which is
 * a sentence to show rather than an error. Never commits and never writes a
 * note: the message only fills the Sync page's box.
 */
export const POST = route(async ({ body, hub }) => {
	const paths = strings(body.paths) ?? [];
	if (!paths.length) return refuse('invalid', 'Select at least one file');
	const result = await suggestCommitMessage(hub.vault, paths);
	return result.ok ? result : { message: '', problem: result.problem };
});
