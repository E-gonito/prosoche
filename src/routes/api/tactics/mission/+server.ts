import { recordMission } from '$server/tactics';
import { route } from '../../route';

/**
 * Record a played mission, `{ mission, device, drills: [{ scenario, answer,
 * ms, at }] }`: each answer judged again on the server and appended to the
 * month's attempt log. Answers `{ attempts }`, each with its verdict.
 */
export const POST = route(async ({ body, hub }) => recordMission(hub.vault, body), {
	conflict: 'The attempt log changed twice while saving. Press save again; nothing was lost.'
});
