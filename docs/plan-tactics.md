# Tactics Trainer: Phase 0 discovery report

The brief, *Prosoche module brief: Tactics Trainer (Ready or Not + Bodycam)*,
asks for this report before any module code. Nothing below has been built.
Section 4 lists where this report departs from the brief, and section 5 the
questions only Errolson can answer.

## 1. Stack

- **SvelteKit 2 with Svelte 5 and TypeScript**, served by `adapter-node`.
  Dependencies: `gray-matter` for frontmatter, `marked` for rendering,
  `better-sqlite3` for the index, `chokidar` to watch the vault, `ts-fsrs` for
  scheduling, `simple-git` for sync. There is no client framework beyond
  Svelte and no CSS library: colours are tokens in `src/app.css`, in light and
  dark.
- **The vault.** Markdown is the only source of truth. All filesystem access
  goes through `src/lib/server/vault/` (`vault.read` returns content plus a
  hash, and a missing note reads as empty). Writes are span rewrites carrying
  the hash they were made against, so an edit made in Obsidian in the meantime
  is refused rather than overwritten.
- **State.** SQLite (`src/lib/server/index/`) is a rebuildable cache of notes,
  tasks, links, tags and full-text search, and holds nothing the vault does not
  say. Day-scoped scratch state that does not need to survive lives in
  `_hub/.state/*.json`, which is never committed (`new-cards.json`,
  `proposals.json`). Settings are frontmatter in `_hub/*.md`.
- **Modules.** A tab is one route folder under `src/routes/<id>/` plus one
  entry in `MODULES` in `src/lib/modules/index.ts`. The rail, the phone's More
  sheet and the palette all draw from that list. `src/how-it-works.test.ts`
  fails if a route has no section in `docs/how-it-works.md`.
- **Sync and deploy.** The container commits the vault one minute after a
  save, and Obsidian on the Mac pulls. Pushing to `main` deploys once CI
  passes.

## 2. Mechanics

### Flashcards

- Cards are regions of notes in Obsidian Spaced Repetition syntax: `::`,
  `:::`, `?` and `??`. They are found by `flashcards/cards.ts` in notes tagged
  `#flashcards`.
- Review state is a comment on the line after the card, written only by
  `cards.ts`, for example `<!--fsrs:2026-10-02,3.21,5.8,4,0,review,2026-09-29-->`.
- Scheduling is FSRS through `ts-fsrs`, wrapped in `shared/scheduler.ts`. It
  is the only scheduler in the app, and it is pure: a state and a day go in,
  and the next state for each grade comes out.
- **A deck is always a glossary.** `decks.ts` says so in its header: "Nothing
  else in the vault is reviewed." A glossary with cards turned on generates
  reversible `??` cards under `Flashcards/<Glossary>/<Category> (cards).md`.
  Fifteen new cards a day are shared across every deck.

### The approval gate

- Every model run goes through the Claude CLI and is read-only: no tools, run
  from a temp directory, and nine guardrails enforced in code
  (`ai/guardrails.ts`).
- A run returns a **proposal**, a list of intentions: `append`,
  `replace-region` or `revise`. The page shows the proposal as a diff.
  `proposal.apply` is the only function in `ai/` that writes, and it writes
  only after a person presses accept. It snapshots the file first, for undo.
- **Which files a feature may write** is one `switch` in `policyFor`
  (`ai/proposal.ts`). An unknown feature writes nothing.
- The second pattern is the glossary scan. There the model returns candidates,
  the person ticks and edits them, and an ordinary non-AI function writes the
  kept ones. That fits the AAR flow better than a diff.

## 3. Integration plan

### Where it plugs in

- **A new tab.** Add `{ id: 'tactics', title: 'Tactics', icon: 'crosshair', href: '/tactics' }`
  to `MODULES`, after Notes.
  - A `crosshair` path goes in `Icon.svelte`.
  - On a phone the tab is reached through More (no `tab: true`), so the tab
    bar keeps its five slots.
  - Not private: its notes may appear in search.
  - Contributes no Today card until Phase 4.
- **Routes.**
  - `/tactics` for mission select and weakest tags
  - `/tactics/mission` for the drill loop and debrief, client-side, posting
    once at the end
  - `/tactics/aar` for authoring
  - `/tactics/scenarios/[id]` to review and approve one scenario
  - `/tactics/stats`
  - `/api/tactics/*` for writes
- **Server modules.** Following the existing pattern, it is one module per
  concern, all of them pure and table-tested apart from their thin vault
  wrappers:
  - `server/parse/scenario.ts`: grammar plus validation, returning
    `{ scenario } | { errors }` with a line number on each error
  - `server/parse/attempts.ts`: the log line grammar, in the same style as
    `parse/ledger.ts`
  - `server/tactics/`: loading, missions and approval
  - `shared/tactics/`: scoring, the sampler and map types, which the browser
    also needs
  - `components/tactics/TacticMap.svelte`: the map renderer

### Vault layout

Proposed: everything under `Games/Tactics/`, because `Games/` already holds
the Overwatch tips. The root path lives once, in `server/config.ts`.

```
Games/Tactics/
  Scenarios/<id>.md         one scenario per note
  AAR/<date> <map>.md       one after-action review per session
  AAR Template.md           beside its use, like Journal/Journal Template.md
  Attempts/<YYYY-MM>.md     the attempt log, one line per drill
  To verify in game.md      the checklist from brief §8
  Principles.md             tactic principle notes (Phase 2 recall source)
```

Your templates sit beside what they template, not in a `Templates/` folder.
They use `**Label:**` lines and `##` headings (see the Bug Report template), so
the AAR template will follow that style.

### What it reuses

- `vault` for reads and hashed writes, and `parse/frontmatter.ts`.
- `marked` rendering, for the Situation and Why sections.
- `scheduler.ts` for due-ness, with no second scheduler.
- `ai/run.ts`, `guardrails.ts` and `proposal.ts` for suggestions.
- The palette, design tokens and the `Confirm` and `Proposal` components.

### Shared code that would change

| Change | Blast radius |
|---|---|
| `MODULES` gets one entry, `Icon.svelte` one icon | Rail, More sheet, palette. Additive. |
| `FeatureId`, `FEATURE_DEFAULTS`, `FEATURE_LABELS` get `tactics-aar` | Settings page shows one more row. Additive. |
| `policyFor` gets a `tactics-aar` arm allowing only `Games/Tactics/Scenarios/<that draft>.md` | The audit screen. Default arm unchanged. |
| Palette's single-key shortcuts (`c` capture, `k`, `r`, …) suppressed while a drill is on screen | **Real conflict.** Answer key C opens the capture box today. Needs a small "keys captured" flag in `palette.svelte.ts`. |
| `decks.ts` learns a non-glossary deck (Phase 2, option B below) | Flashcards page, Today's card, the new-card share. The largest change. Deferred to Phase 2 with its own design. |
| `README.md` "Seven tabs", `docs/how-it-works.md` gets a Tactics section | Required by `how-it-works.test.ts`. |

Nothing in `parse/task.ts`, the index schema or the vault module changes, so
`vault-conformance.test.ts` is unaffected.

### Risks

- **Commit churn.** Each mission is one append to the log, so one commit. A
  per-drill write would be ten.
- **Latency is measured in the browser** (`performance.now()` from the first
  render of the options) and trusted by the server. That is fine for one user,
  but worth stating.
- **The phone.** The keyboard shortcuts do nothing there. Tapping works, but
  latency figures from a phone and a PC are not comparable, so each attempt
  records the device class.
- **Stale content.** Both games patch often. `verified_version` is free text,
  so "stale" can only mean "verified against a version other than the one you
  set as current". That needs a `current_version:` per game in
  `_hub/tactics.md`.

## 4. Proposed adjustments to the brief

1. **Two approvals, not one.** Prosoche's gate is "a person accepts a proposed
   write". `status: approved` is a different act: you vouching for the content.
   Proposal:
   - AI suggestions arrive as glossary-scan-style candidates (situation,
     options, distractors, tags, map) or as a diff. Accepting one writes into
     a `status: draft` note.
   - **Approve** is a separate human-only button on the scenario page, and no
     AI code path can reach it.
   - Approve refuses while `## Why` is empty or still carries the
     `> [!suggestion]` callout that marks an AI draft.
   - Approve rewrites only the `status:` line.
2. **`## Penalty` moves into frontmatter**, as `roe_violation: [A]`. One parser
   (YAML) instead of a second ad-hoc grammar in the body, and it validates
   against the option letters. `## Answer` stays in the body, as `B`, or
   `A1, A3, A2` for `clear-order`.
3. **The attempt log is markdown in the vault, not SQLite or `.state`.** SQLite
   is a cache and `.state` is never committed, so either would lose your data.
   The format is one line per attempt, monthly files, in the same style as
   `Ledger.md`:
   ```
   - 2026-10-20T21:14:03 ron-0001 mission:: m-20261020-2114 answer:: B correct:: true ms:: 2310 roe:: false device:: pc
   ```
   This is readable in Obsidian and greppable, so it needs no export step. The
   log is the only state:
   - per-tag EWMA and difficulty ramps are **computed by replaying it**, a pure
     function with nothing stored
   - so is each scenario's due-ness, by replaying its attempts through
     `scheduler.ts`: correct and in time is *good*, late is *hard*, wrong or
     timeout is *again*
   
   Nothing is written into scenario notes on a drill, so drilling never
   touches your content.
4. **No `recall` drills inside missions.** Recall is what Flashcards already
   does well, so Phase 2 puts recall cards in the Flashcards tab. The options:
   - **A.** A `Tactics` glossary with cards on. It needs no shared change, but
     glossary cards are reversible term↔definition, and "What makes a
     suspect a lethal-force threat?" reads badly in reverse.
   - **B (recommended).** Teach `decks.ts` a second kind of deck: a folder
     named in `_hub/flashcards.md` holding one-way `?` cards that
     `cards.ts` already parses. Each card links back with `[[ron-0001]]`.
     This is the one change with real blast radius, so it gets its own plan at
     Phase 2.
5. **The map schema** is a fenced ` ```tactic-map ` JSON block carrying
   `"v": 1`. It is validated and rendered to SVG, and it shows as plain code in
   Obsidian. Entity state is drawn as a glyph plus a text label, never colour
   alone.
6. **The sampler** takes the RNG as a parameter (seeded `mulberry32` in tests).
   Its inputs are the attempt history, the scenarios and the day, so it is
   pure.
7. **Seed content** is ≤ 10 `shared` CQB scenarios, `inferred`/`draft`, plus
   `To verify in game.md`, with no ROE scenarios. Drafts are excluded from
   missions by default. A "Include drafts" switch exists only so the engine
   can be tested before you approve anything.

### Phase 1 deliverable, restated

- The tab, the scenario parser and validator, and `threat-call` plus
  `clear-order`.
- The map renderer, timer, scoring config, ROE cap and debrief.
- The attempt log and the sampler.
- Tests: parser, scoring (ROE cap, late-correct), and the seeded sampler.
- One squash-merge to `main`, after `npm test`, `npm run check` and the e2e
  suite.

## Answers (2026-10-20), and what changed

1. Ready or Not with the AI squad, so `squad-command` will target the command wheel.
2. Bodycam Deathmatch most, so Phase 3 puts peek, hold and trade drills
   before Body Bomb site execution.
3. PC, and drill keys should mirror the in-game binds where they can. The
   binds are not known yet, so Phase 1 uses 1–9 and A–I.
4. His deaths are not checking behind, re-peeking the same angle, getting
   caught reloading, losing gunfights at distance, reacting too slowly, and
   getting shot from an unchecked angle. The eight starter drafts target the
   positional ones. Aim at distance and reaction time are out of scope.
5. He is not sure about session length, so missions are 8, 10 or 12 drills,
   chosen on the page.
6. The folder is `Tactics/` at the vault root, not `Games/Tactics/`.
7. Recall cards go in a Tactics glossary (option A), so `decks.ts` does not
   change.
8. PC only for now, with the layout kept usable on a phone for some tests.

Phase 1 as built also serves `hold-peek` and `squad-command`, because every
choice drill is the same mechanic. That let the starters cover the deaths
above. The palette conflict needed no shared change: the drill page catches
keys in the capture phase and the global handler skips a key that has
already been handled.

## 5. Open questions

The five from the brief:

1. **RoN:** solo with the AI squad, or co-op with humans?
2. **Bodycam:** Body Bomb, Deathmatch, or both? Which do you play most?
3. **Platform and keybinds:** PC? Should drill keys mirror your in-game binds?
4. **Seed data:** your last 5 deaths or score penalties, one line of diagnosis
   each.
5. **Session length:** missions per sitting, and how often?

And three from discovery:

6. **Folder:** `Games/Tactics/` (proposed) or `Tactics/` at the vault root?
7. **Recall cards:** option B, a non-glossary deck (recommended), or A, a
   glossary?
8. **Phone:** drill on the phone too, or PC only?
