import { setNewCardsPerDay } from '$server/flashcards/decks';
import { route } from '../../route';

/**
 * Set how many new cards a day join the reviews across every deck,
 * `{ perDay }`, a whole number from 0 to 500, writing `new_per_day:` into
 * `_hub/flashcards.md`. Answers `{ perDay }`.
 */
export const POST = route(async ({ body, hub }) => setNewCardsPerDay(hub.vault, body.perDay), {
	invalid: 'New cards a day is a whole number from 0 to 500.'
});
