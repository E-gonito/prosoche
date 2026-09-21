import { hub } from '$server/hub';

// Start indexing, watching and syncing as soon as the server boots, rather
// than on the first request, so the first page load is already warm.
hub();

export const handle = async ({ event, resolve }) => resolve(event);
