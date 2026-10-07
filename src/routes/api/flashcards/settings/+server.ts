import { setFlashcardSettings } from '$server/flashcards/decks';
import { route } from '../../route';

/**
 * Change the flashcard settings, `{ perDay?, focus? }`: the new cards a day
 * across every deck, a whole number from 0 to 500, and the focus, a list of
 * `<Glossary>/<Category>` items to take the new cards from (empty for none).
 * Writes `new_per_day:` and `focus:` into `_hub/flashcards.md`, only the
 * ones given. Answers `{ perDay, focus }` as now written.
 */
export const POST = route(async ({ body, hub }) => setFlashcardSettings(hub.vault, await hub.workspaces(), body), {
	invalid: 'New cards a day is a whole number from 0 to 500, and a focus is categories of a deck that has cards.'
});
