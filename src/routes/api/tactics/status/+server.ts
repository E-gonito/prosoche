import { setStatus } from '$server/tactics';
import { route } from '../../route';

/**
 * Set a scenario's status, `{ id, status, why? }`: draft, approved or
 * retired. Only its `status:` line changes, and its `## Why` body when `why`
 * is given. Approving refuses while the Why is missing or still a
 * suggestion. Answers `{ status }`.
 */
export const POST = route(async ({ body, hub }) => setStatus(hub.vault, body.id, body.status, body.why));
