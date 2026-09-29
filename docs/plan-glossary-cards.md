# Plan: flashcards from glossaries, kept in step

Written 2026-09-29, after an interview with the author. **default** marks a
choice the author was not asked about.

## Decisions

1. **Cards come straight from the entry. No AI.** Front: the term. Back: the
   definition, then the `→` relevance line. A missing relevance line means
   the definition only.
2. **Both directions.** Each term is one reversible card, using Spaced
   Repetition's multi-line reversed form (a `??` line). It is reviewed term to
   meaning and meaning to term.
3. **Fully automatic.** Once a glossary is linked to a study subject:
   - every term gets a card, the existing ones at once;
   - a new term gets a card;
   - an edited definition or relevance updates that card's text and keeps its
     review history;
   - a term moved to another category moves its card, review history and all;
   - deleting a term leaves its card, so the author deletes cards themself;
   - renaming a term makes a new card and leaves the old one (**default**,
     because an entry has no identity but its name).
4. **A glossary names its subject once.** The glossary file's frontmatter gets
   `study: <subject slug>`, set from a picker on the glossary page. Clearing it
   stops the syncing and leaves the cards.
5. **One card file per category**, at
   `<subject home>/Flashcards/Glossary/<Glossary name>/<Category>.md`. The
   glossary name is in the path so two glossaries linked to one subject never
   share a file (**default**). A term with no category goes in
   `Uncategorised.md`.
6. **eye2gene gets a study subject.** The lead creates it after merge and
   links the eye2gene glossary to it. Computer Science links to CS study.
7. **New cards per day: 20 per subject.** Unseen cards join reviews 20 a day,
   in a stable order; the rest wait. The limit can be set per subject with
   `new_per_day:` in the subject's workspace file. This applies to every card,
   not just glossary cards.

## The generated file

```markdown
---
goal:
glossary: Computer Science
category: Cloud
---

#flashcards

Made from [[Computer Science]] (Cloud). Edit the terms there; this file is
kept in step with the glossary.

VPC
??
An isolated virtual network within a cloud provider where you control IP
ranges, subnets, routing and security groups.
→ Where eye2gene's endpoints live.
<!--SR:!2026-10-02,3,250!2026-10-01,1,230-->

CDK
??
…
```

- The file is prosoche's, like a workspace's `Board.md`: its cards follow the
  glossary. But `goal:`, which the author sets on the Flashcards tab, and every
  `<!--SR:…-->` review comment are always kept.
- Each card's text goes through the same escaping as the Anki import and Make
  cards (`cardBlock`), and must read back as the same card through
  `scanCards` before anything is written.
- Sync is a pure reconciliation, table-tested: glossary entries plus the
  existing generated files in, per-file edits out. A card is matched by its
  term (`normaliseTerm` of the front). Edits are byte-exact line
  replacements, moves and insertions. Nothing outside
  `Flashcards/Glossary/<Glossary name>/` is ever touched.

## When it runs

- Right after any write the app makes to a linked glossary (add, edit, the
  scan's Add N terms, linking itself).
- On any change to a linked glossary file from outside, such as an Obsidian
  edit or a git pull, via the vault's change events. It is debounced and
  runs one glossary at a time.
- Once at hub start, for every linked glossary.
- It writes only when something differs. A sync with nothing to change is a
  no-op, and it never runs a model.

## Screens

- **Glossary page:** a "Flashcards" line with the subject picker and its
  state, e.g. "226 cards in CS study · up to date", linking to that subject's
  Flashcards tab.
- **Study Flashcards tab:** the generated files show like any card file,
  grouped by goal, with the same goal picker. The review queue respects the
  new-per-day limit, and the counts say "20 new today · 206 waiting".
