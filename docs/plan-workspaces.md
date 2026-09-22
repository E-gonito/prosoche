# Plan: workspaces that show your real work

Written 2026-09-22 from an audit of the live app against the author's vault.
Each phase is a branch, merged to `main` with `--no-ff` once `npm test`,
`npm run check` and `npm run e2e` pass, then deployed with `npm run build`
and `systemctl --user restart prosoche.service`. Every phase updates
`docs/how-it-works.md`, which `src/how-it-works.test.ts` reads.

## Goal

Productivity: easy bookkeeping, a reminder of what to do, easy planning and
scheduling, and questions to the AI that get answered from the notes.

## Diagnosis

The workspaces read as empty because the product only counts work written in
conventions the author has never used, while the author's real work is
written somewhere it does not look.

- Every day's note plans "10:30 - 18:00 Work on eye2gene", "Work on Kaya
  `Q1`", "Work on Filipino Cusina Ko `Q1`". None carries `#ws/…`, so the
  Time tab, the rail counts, Insights and Today's "From your workspaces"
  card all see nothing.
- Time is only counted from `## Time log` lines the timer writes. The
  author ticks blocks instead. Last week: 9 ticked timed blocks, 0 timer lines.
- A board card needs a quadrant, due date, id or the workspace tag. The 414
  open checkboxes under eye2gene are all in one manual test plan, so the
  board is empty and the deck note `Work Projects/eye2gene/Tasks.md` does
  not exist.
- Dragging a workspace card onto Today's timeline calls `editTask` with a
  time range on the card's own line in the project note. The range has no
  date, and Today's timeline only reads the day's note, so the card vanishes
  after the drop. `src/lib/components/Timeline.svelte` `schedule()`.
- `Journal/2026/09/22.md` is committed with git conflict markers around
  `## Time log` (commit ac2bce0). The hub's timer append and an Obsidian
  edit on another device collided. The app does not notice.

Study and Personal work today because their notes already follow the
conventions those widgets read. The model is fine; the project template's
conventions do not match how the author writes.

## Ground rules

From `CLAUDE.md`: markdown is the only truth; preserve every byte the user
did not change; task edits go through `rewriteTaskLine` spans; appends go
through `appendUnderHeading`; filesystem only in `src/lib/server/vault/`,
SQL only in `src/lib/server/index/`; no model writes without an accept
step; `vault-conformance.test.ts` must pass, and `VAULT_PATH=~/vault npm
test` before anything in `parse/` changes. Nothing here changes the task
grammar.

## Phase 0: fix what is broken (half a day)

**0a. Scheduling a card onto a day writes a block into the day's note.**

Design twice. (A) Keep the time on the card and add a `⏳ YYYY-MM-DD` field
so the day is known; Today's timeline then reads tasks anywhere with
`⏳ = today`. (B) Append a block to the day's `# Tasks` section that links
back to the card. Pick B: the day's note stays the record of the day (the
README's premise), Day Planner in Obsidian sees the block, phase 2's time
attribution works on it, and the card's line is untouched. The cost is two
checkboxes for one piece of work, which is honest: a block is time on X, a
card is X finished.

- New module `src/lib/server/day-plan.ts`: `addToDay(vault, workspaces,
  day, task, time?: {startMin, endMin})`. Opens the day via `openDay`
  (creating it from the template), appends under `config.dailyNote.tasksHeading`
  (`# Tasks`, new config field) with `appendUnderHeading`. Line shape follows
  `cards.ts`: `- [ ] 10:00 - 10:30 <text> [[<note path without .md>]] `Q1`
  #ws/<slug>`; quadrant and tag only when the card or its workspace has one.
  Returns the appended line and its number. Never edits the card.
- `POST /api/day/[day]/plan` `{path, line, expectedRaw, startMin?, endMin?}`
  → 201 with the new task. 409 when the card line changed.
- `Timeline.svelte` `schedule()`: when `task.path !== dayPath`, call the new
  endpoint instead of `editTask`; the page `invalidateAll()`s. Dragging a
  block that is already in the day's note keeps the current span edit.
- Tests: `day-plan.test.ts` (creates the day from the template, inserts
  before `## Backlog`, leaves every other byte alone, no tag when the
  workspace has none). e2e in `02-today.spec.ts`: drag "Finish chapter 3"
  onto the timeline → today's note gains exactly one line, `Study/Algorithms.md`
  is byte-identical.

**0b. A note with conflict markers says so.** `NoteIndex.put` records a
`problems` row when a note contains `^<<<<<<< ` and `^>>>>>>> ` lines. Today
and the note page show the shared `.problem` line "This note has git
conflict markers; resolve it in Obsidian or on the sync page." Test in
`index.test.ts`. No automatic fix: the markers are the user's to resolve.

## Phase 1: a daily block belongs to a workspace (one day)

**Aliases in the workspace file.** `aliases: [eye2gene, e2g]` in
frontmatter. `Workspace.aliases: string[]` in `workspaces.ts` `toWorkspace`
and `renderWorkspace`. `workspaceFor()` gains an optional `text` and a fourth
rule, tried last: a whole-word, case-insensitive match of any alias in
`displayText(text)`. Tag, then folder, then frontmatter, then alias, so a
note in Personal's folder that mentions Kaya stays Personal. Only tasks in
no workspace folder are ever alias-assigned, which is exactly the daily
notes and the Inbox.

Callers that pass `text`: `timelog.weekSummary` (planned blocks),
`timelog.startTimer` (so the timer line gets the tag), `day-plan.addToDay`,
and phase 5's Today loader. The board's `ours()` does not need it.

**A workspace control on every task.** `CardDrawer.svelte` gets a
"Workspace" select listing the workspaces and "none"; choosing one calls
`editTask` with `addTags: [ws.tag]` and `removeTags` of any other `ws/`
tags, one span edit. Today gets the drawer: clicking a `TaskRow`'s text or a
timeline block's label opens `CardDrawer`, so quadrant, due date and
workspace are editable from the day. `TaskRow` and the timeline block show a
coloured dot for the attributed workspace (tag or alias) with the name as
the title.

- Tests: `workspaces.test.ts` alias order and word boundaries ("Kaya" does
  not match "Kayak"); `timelog.test.ts` weekSummary scoped by alias; e2e:
  the drawer's select writes `#ws/study` and the rest of the line is
  unchanged (`changedLines` helper in `08-workspaces.spec.ts`).
- Docs: README "What it reads" gains `#ws/<slug>` and `aliases:`;
  how-it-works "Workspaces and boards" gains the fourth rule.

## Phase 2: actual time from what you tick (half a day)

`plannedVsActual` gains `doneMinutes`: a ticked block with nothing logged
against it counts its planned duration as done. `weekly()` generalises from
`TimeEntry[]` to attributed spans `{day, minutes, workspaceTag, quadrant,
source: 'timer' | 'block'}`; timer entries and done blocks both map into
it, done blocks attributed via `workspaceFor(..., {path, tags, text})`.
`WeekSummary` and each `days[]` row carry `doneMinutes`, `loggedMinutes`
and `plannedMinutes`. Per-workspace done time is `coveredMinutes` over that
workspace's blocks, so nested blocks count once; sums across workspaces may
exceed the day, which the widget's footnote states.

`Time.svelte`: headline "7h 30m done · 0m timed · of 7h 30m planned"; the
bar keeps the planned track, fills done, overlays timed darker. Empty state:
"Nothing ticked or timed against eye2gene this week." The weekly review's
`render()` picks the figures up unchanged.

- Tests: table tests in `timelog.test.ts` for done-only, timer-only, timer
  over a ticked block (no double count), nested done blocks, unassigned.
- how-it-works: the Time widget's sentence.

## Phase 3: the deck is the board, and the board reaches Today (one day)

`isCard(task, workspace: {tag, deck})` in `src/lib/shared/board.ts`: the
tag, or a mark of intent, or `task.path === workspace.deck`. Every open
checkbox in the deck is a card, no metadata required; lines elsewhere in
the folder still need a quadrant, so the test plan stays out.

New `openCards(index, workspace, workspaces)` in `board.ts`: the
claimed-and-ours-and-isCard filter that `buildBoard` already does, exported
so the Today loader, the rail count in `+layout.server.ts` and phase 5's
briefing use the same rule. The Today loader stops using
`requireQuadrant` and folder-only `workspaceFor`.

Board empty state: "No cards yet. Add one and it starts Work
Projects/eye2gene/Tasks.md." (createCard already creates the deck.) The
excluded line becomes per-note: "414 checklist lines in Data
Portal/manual_test (1) are not cards", and the promote review opens one
note at a time instead of a flat 60-line list. The earlier idea of a "hide
this note" control is dropped: it would need the hub to rewrite the
workspace file or the note's frontmatter behind the user's back.

- Tests: `shared/board.test.ts` deck rule; `board.test.ts` "every open
  checkbox in the deck is a card"; `02-today.spec.ts` shows a deck card;
  `08-workspaces.spec.ts` column counts re-checked against the
  `Work/Atlas/Tasks.md` fixture.

## Phase 4: one Overview per project (half a day)

`TEMPLATE_TABS.project` → Overview `[board, time]`, Notes, People, Blocked,
Insights. `business` → Overview `[board]`, Notes, People, Blocked,
Insights. Tabs get a count: widget modules may export `count(ctx):
Promise<number>` (board = open cards, blocked = items, people = people
notes). `widgets.ts` gains `tabCounts(tabs, ctx)` that runs the first
counting widget of each tab; the tab bar shows the number and mutes a zero.
Tabs are never hidden. The author's six workspace files are the user's
documents: the new `tabs:`, `aliases:` and `deck:` lines are proposed as a
diff for them to accept (see "Vault changes").

## Phase 5: Today knows your projects (one day)

- A chip row under the timeline heading: per workspace, planned and done
  minutes for this day, from the phase 2 functions over `scheduled`.
- "From your workspaces" lists `openCards` sorted by `compareCards`, with a
  due chip on `TaskRow`, and an "Add to today" button per row for phones,
  which calls the phase 0 endpoint with no time so the card lands in
  Unscheduled and can be dragged onto the timeline. Dragging still works.
- Briefing: `gather()` gains `fromWorkspaces` (top three open cards per
  workspace, skipping ones already in the day by `matchKey`), `render()`
  adds a **From your workspaces** section. Recommend adding the two
  marker lines to `Journal/Journal Template.md` so the 07:00 job writes
  without a click; the app never edits the template itself.
- Rail count: open cards via `openCards`, Q1 first in the tooltip.

Tests: `briefing.test.ts` render table; e2e in `02-today.spec.ts` for the
chip row and "Add to today".

## Phase 6: insights that know the facts (one day)

Ask retrieval only sees prose, so "where did my eye2gene time go this
week" cannot be answered. New `src/lib/server/ai/facts.ts`:
`workspaceFacts(deps, workspace, day)` returns a markdown block, capped at
about 1,500 tokens: the week's planned, done and timed minutes by day; open
cards by column; overdue and blocked; this week's daily blocks attributed
to the workspace with day, minutes and done; the ten most recently changed
notes. `ask()` prepends it, wrapped by `wrapAsData`, whenever
`scope.kind === 'workspace'`, for both `ask` and `insights`, and cites it as
"computed from your notes on YYYY-MM-DD" rather than as a note. Insights
suggestions become "What did I finish in eye2gene this week?", "Where did
my eye2gene time go?", "What has been open longest?". Read-only as before;
the facts are index queries, no model involved in producing them.

Tests: `facts.test.ts` render table; `ask.test.ts` with the stub CLI
asserting the prompt carries the facts block inside the data wrapper.

## Phase 7: Notes tab and Linear (half a day)

- `widgets/notes.ts` uses `index.notes()` instead of reading up to 600
  files (the index already stores mtime). Title is the file name; the
  note's own title is the subtitle when it differs, which fixes timesheets
  showing as "01/09/2026". Grouped by the first subfolder under the
  workspace folder.
- Linear: `Environment=HUB_LINEAR_TOKEN=…` in the user unit
  (`systemctl --user edit prosoche.service`), `linear` added to the
  eye2gene Overview. Needs the author's personal API key. A Linear column on
  the board is deferred until the widget has been used for a week.

## T3 Code from the browser

Already possible without code. The `t3 serve` service on this machine
(version 0.0.42, unit `t3code.service`) binds `0.0.0.0:3773` and serves the
full T3 Code web client at `/`; only the WebSocket needs a credential.

1. `~/.t3/runtime/versions/0.0.42/t3 pair --ttl 1h` prints a pairing URL and
   QR code; open it in the browser once per device. `--tailscale` publishes
   the server over Tailscale Serve HTTPS, which is the better setup since
   prosoche is on the tailnet too and a secure origin is needed for
   clipboard and notifications.
2. In prosoche: a "T3 Code" entry in the nav and palette pointing at
   `HUB_T3_URL` (new config field, default empty so the entry is absent
   when unset), and an optional `t3:` field in a workspace file for a
   per-project deep link once the client's route shape is confirmed.

Not recommended: an iframe (the server sends no frame-blocking header, but a
paired session and its WebSocket inside a cross-origin frame will be
blocked by third-party storage rules in Safari and Chrome), or a chat bridge
against T3's authenticated WebSocket API, which is internal and auto-updates.

## Vault changes that need the author's OK

None of these are made by the app.

1. `Journal/2026/09/22.md`: remove the three conflict-marker lines and keep
   both sides (the blank line and the `## Time log` section).
2. `_hub/workspaces/*.md`: `aliases:` (eye2gene: `[eye2gene, e2g]`, Kaya:
   `[kaya]`, Cusina Ko: `[cusina ko, cusina]`, cs-study, personal,
   side-projects as the author names them in daily notes), the phase 4
   `tabs:`, and an explicit `deck:` where the default is not wanted.
3. `Journal/Journal Template.md`: the two briefing marker lines under a
   `## Briefing` heading, if the author wants the 07:00 briefing written
   automatically.

## Order and size

| Phase | Depends on | Size |
|---|---|---|
| 0 fix scheduling and conflict banner | – | 0.5 day |
| 1 aliases and workspace control | – | 1 day |
| 2 done blocks count as time | 1 | 0.5 day |
| 3 deck is the board, openCards | – | 1 day |
| 4 Overview tab and counts | 3 | 0.5 day |
| 5 Today knows projects, briefing | 2, 3 | 1 day |
| 6 facts for Ask and Insights | 2, 3 | 1 day |
| 7 Notes tab, Linear | – | 0.5 day |

Phases 0, 1 and 3 can run in parallel worktrees; 2 follows 1; 4 follows 3;
5 and 6 follow both. After phases 0 to 2 the author's real week shows on the
Time tab and Today the next morning.

## Decisions taken, with the default

- Scheduling a card writes a linked block into the day's note rather than a
  dated time onto the card.
- A ticked block counts its planned duration as done unless a timer line
  matched it.
- Tabs show counts and mute at zero; they are never hidden.
- The app never edits the Journal Template or a workspace file; those are
  proposed to the author as diffs.
