import { addStarters } from '$server/tactics';
import { route } from '../../route';

/**
 * Write the starter notes that are not in the vault yet: a few shared CQB
 * scenarios, all inferred drafts, and the list of claims to verify in game.
 * Never overwrites. Answers `{ written }`, the paths created.
 */
export const POST = route(async ({ hub }) => addStarters(hub.vault));
