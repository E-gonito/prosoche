# Plan: a focus for new flashcards

Written 2026-10-06, after an interview with the author. Built 2026-10-07; the
only change from this plan is that `dealBy` applies to reviews alone, and new
cards take turns by the plan's own pools, so a focus of two categories in one
deck still alternates between them. **default** marks a
choice the author was not asked about.

Today the day's new cards (15 unless `_hub/flashcards.md` says otherwise) are
dealt evenly between the glossary decks, in file order within each. A
category chip on /flashcards only filters that mix, so "Networking" may offer
no new cards at all. There is no way to say which categories to learn from.

## Decisions

1. **A focus is a list of categories, kept until changed.** Set tonight, it
   holds tomorrow and every day after. An empty list means no focus, and
   behaviour is exactly what it is now.
2. **It decides new cards only.** Reviews already due keep coming from every
   category, so nothing left out piles up overdue. Overdue reviews still hold
   back new cards, one each, as now.
3. **Only these.** With a focus, every new card comes from a focused
   category. When they run out before the day's number, the day has fewer
   new cards; the rest of the decks do not fill in.
4. **Evenly per category**, across glossaries: Networking, Git and Imaging
   with 15 a day is 5 each, whichever glossary each is in. A category that
   runs out gives its share to the others.
5. **A focus ignores a glossary's own `new_per_day:` cap.** The shared number
   a day is the only limit. Without a focus the caps apply as now.
6. **File order within a category**, as now: terms in the order written.
7. **Changing the focus mid-day keeps the day's total.** Cards already begun
   stay begun; what is left of the day's number comes from the new focus.
   Changing it never lets extra new cards in.
8. **Set from the chips on /flashcards.** Obsidian can edit it too, since it
   lives in the vault.

## Where it lives

`_hub/flashcards.md`, beside `new_per_day:`:

```markdown
---
new_per_day: 15
focus:
  - Computer Science/Networking
  - eye2gene/Imaging
---
```

Each item is `<Glossary>/<Category>`, the card file's path under
`Flashcards/` without ` (cards).md`, so it reads the way the folders do. An
item matching no category of a deck whose cards are on (a category renamed,
a glossary switched off) is ignored. If none match, there is no focus
(**default**: an empty focus should not silently mean no new cards).

The file does not exist on the live vault yet; the first save creates it,
as saving the number a day already does.

## The page

The category chips stay links to a review of that category. Above the decks,
a **Choose focus** button turns every chip into a toggle (**default**: one
edit mode with one save, rather than a toggle per chip that writes on every
tap, which is easy to hit by accident on a phone). **Save focus** writes the
list; **Clear** empties it. Focused chips are marked in accent whenever a
focus is set, and a line under the due count says
"New cards today: Networking, Imaging".

Today's Flashcards line is unchanged.

## Design

### Counting first reviews by card file

`_hub/.state/new-cards.json` counts first reviews per pool key, and a pool is
a deck (`deck/computer-science`). A focus needs pools that are single
category files, and decision 7 needs the day's total to survive a change of
pools. Both are met by counting per card file instead:

```json
{ "day": "2026-10-06", "introduced": { "Flashcards/Computer Science/Networking (cards).md": 3 } }
```

A pool's `begun` is the sum over the files inside it; the shared `left` is
the number a day less the sum over every file, whatever the pools are now.
An old file with `deck/...` keys still counts towards the total for the rest
of its day and then expires as usual.

### Pools that are a file or a folder

`NewCardPool.folder` becomes `NewCardPool.scope`: a vault-relative folder or
one card file. `inScope(path, scope)` is the one place that says which (a
path equal to the scope, or inside it as a folder). `releaseNew` is
otherwise unchanged.

Grading keeps deck pools. `cardPools` still answers one pool per deck, since
that is what says which folders a grade may write, and a card from a
category out of focus may still be due for review.

### Dealing reviews

`dueCards` deals cards out by the plan's pools. With a focus those are
categories, so reviews from other categories would all land in the first
pile. `DueQuery` gains `dealBy: string[]`, the scopes cards take turns by;
`deckQueue` passes the deck folders, so reviews always alternate by deck and
new cards by focus.

### Settings

`setNewCardsPerDay` becomes `setFlashcardSettings(vault, { perDay?, focus? })`,
one function rewriting only the keys given (`setFrontmatterField`, every
other byte kept), refusing an unknown category as `invalid`. The settings
endpoint takes either field. `newCardsPerDay` becomes `flashcardSettings`,
reading both.

### Two designs considered

- **A. Focus as the plan's pools** (chosen). The focus only changes which
  pools `newCardPlan` is given and their caps; the release, the overdue
  hold-back and the review session all work as they do.
- **B. Focus as a filter after release.** Deal as now, then drop the
  unfocused cards and top up. Simpler to bolt on, but the top-up has to
  re-run the dealing to stay even per category, and the held-back count would
  be worked out twice. A puts the rule in one place.

## Tests

- `new-cards.test.ts`: counts by file; a pool's `begun` sums the files in its
  scope; the shared total counts every file, including out-of-focus ones and
  legacy keys; a file scope matches only itself.
- `decks.test.ts`: a focus offers only focused categories; evenly per
  category across two decks; a deck cap is ignored under focus and applied
  without; a category that runs out gives its share away and the day stops
  short; stale items are ignored, all stale is no focus; changing focus
  after five first reviews leaves ten; reviews from unfocused categories are
  still due; saving the focus keeps every other byte of the file.
- e2e: choose two categories, save, see only their new cards in Review all,
  clear.

## Not doing

- A separate focus for today and tomorrow.
- Narrowing reviews, or putting focused reviews first.
- Shuffling new cards.
