import { paletteSearch } from '$server/palette';
import { route } from '../route';

/** `?q=`: everything the command palette can find in the vault (see `paletteSearch`). */
export const GET = route(async ({ url, hub }) => paletteSearch(hub.index, await hub.workspaces(), url.searchParams.get('q') ?? ''));
