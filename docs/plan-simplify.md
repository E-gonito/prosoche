# Plan: fewer lines, one habit

Written 2026-09-29, after a full audit of the code and the author's vault and
an interview with the author. Items marked **default** were not asked and
stand unless the author says otherwise. Each phase is one branch and one
`--no-ff` merge to main, in order; the model named for a phase is the one to
hand it to.

## Why

The codebase is 45,000 lines, 13,000 of them tests. The audit found about
3,000 lines removable with no behaviour change and the author chose to cut
about 4,500 more (Meetings, four AI features, the inert permission modes).

The vault says what is used. In September: 22 daily notes, 116 time blocks,
26 of 495 tasks ticked. The glossaries are 2,975 lines and glossary look-up
is 38 of 70 AI runs. Two of five workspaces have a board; no workspace has an
Inbox.md, Log.md, Overview.md, CRM folder or Pages folder. One meeting note
exists. The author does the habits and forgets to tick, and the timeline
shows the template's habits but not the project work planned for the day.

## Decisions

1. **Evening review is the ticking fix.** One screen listing today's blocks
   and tasks with a large tick per line and a "skipped" option, reachable from
   Today and from the phone tab bar. Each tick writes one character on one
   line through `tasks.ts`. Skipped writes `- [-]` (**default**: Obsidian's
   cancelled state, which `parse/task.ts` must accept and render as struck
   through).
2. **Planned work comes from boards.** The "From your workspaces" cards on
   Today get a drag grip; dropping one on the timeline appends a linked block
   to the daily note under `# Tasks` through `day-plan.ts`, exactly as
   "Add to today" does for overdue rows. The board stays the source of truth.
3. **prosoche creates today's note on an explicit click** from
   `Journal/Journal Template.md` when it is absent. Never on a timer, never
   from a card drop. The empty state names the path it will create.
4. **AI keeps three features:** glossary look-up, briefing, Date insights.
   Cut: glossary scan for new terms, make cards from notes, file capture,
   meeting drafts, the pending queue. The scan was merged the same day as the
   interview; **confirm with the author before deleting it** (phase 2).
5. **Permission modes go.** Every model run is already forced read-only in
   code; the propose and apply modes, the sandbox copy and the tool branch
   are reachable only from tests (**default**, follows from 4). Guardrail two
   becomes "read-only, always", which is stronger. The briefing's exception
   to guardrail one goes too; it contradicts CLAUDE.md.
6. **Meetings module goes.** Calendar events still show on the Today timeline
   as read-only sand blocks; they stop linking anywhere. `_hub/meetings.md`,
   `meetings: true`, the notebook, primer and prep all go.
7. **Workspaces keep every section** (board, Overview, Inbox, Log, CRM,
   Pages, Notes). The author kept them despite no data; do not cut.
8. **Study keeps everything** (goals, reading list, sessions, flashcards,
   Anki import, glossary cards). The author will run the Anki import.
9. **Glossary cards stay as shipped**: one card per term, no AI, generated
   into `<subject>/Flashcards/Glossary/<Glossary>/<Category>.md` and kept in
   step, linked by `study: <slug>` in the glossary's frontmatter. The
   interview's "inside the glossary file" was answered before this landed;
   the shipped design already gives the study link the author asked for
   (**default**: keep it).
10. **Flashcards use Anki's scheduler, FSRS, through its official
    TypeScript port `ts-fsrs`,** rather than a hand-written copy of Anki's
    older SM2. prosoche stops being compatible with the Obsidian
    spaced-repetition plugin. One comment format of prosoche's own holds
    the FSRS state; the old `<!--SR:…-->` comment is read once to seed a
    card and rewritten in the new form on its next review. Review happens
    only in prosoche; the Anki app is not needed. If reviews done in
    AnkiDroid ever need to count, the path is Anki's headless Python
    package as a backend, which was considered and set aside because it
    would move review state out of the vault.
11. **Date stays** and is hidden from the rail and More sheet on any machine
    whose vault has no `Private/` folder (**default**).
12. **Shrink before building.** Deletions land first so the new features are
    written into a smaller codebase.
13. **One inbox, read on Today, three exits.** Everything captured, from
    any box, key or the phone share sheet, lands in `Inbox/Capture.md`.
    Today reads it back as an "Inbox" card listing the unfiled lines, and a
    triage page gives each line three keys: plan onto today, file as a board
    card, drop. A workspace's Inbox tab becomes a filter of that one file by
    the workspace's tag or alias; `<home>/Inbox.md` is no longer written
    (this narrows decision 7 by one file; the tab stays). A captured line
    that already carries a time goes straight into the daily note, and one
    that names a workspace by tag or alias goes straight onto its board.
14. **Everything in one place.** The author wants one app over one vault,
    not the best free tool for each job. A module is not cut because Anki,
    Logseq or an Obsidian plugin does the same thing; it is cut only when
    the author does not use it. The corollary is that nothing is done twice
    inside prosoche: one inbox, one capture path, one scheduler, one
    runner, one stylesheet. Simplification here means integrating, not
    removing.

## What the author does by hand

Not code. Each removes a daily friction the app cannot fix.

- Obsidian daily notes: set the folder to `Journal`, not `Journal/2026`, and
  keep the format `YYYY/MM/DD`. Delete the stray
  `Journal/2026/2026/09/29.md`.
- Cut `Journal/Journal Template.md` to the habits actually done daily and
  give each a time, so Today opens with the timeline already filled.
- Add `aliases:` to the workspace files (`[kaya]`, `[cusina, "cusina ko"]`,
  `[eye2gene, e2g]`) so "Work on Kaya" is counted, and delete the `tabs:`
  blocks the code no longer reads.
- Run the Anki import once for Computer Science.

## Phases

Every phase: `npm test`, `npm run check`, and `VAULT_PATH=~/vault npm test`
whenever `parse/` or `study/` changes. Phases that touch a screen run
`npm run build && npm run e2e`. `src/how-it-works.test.ts` fails when a
`## Screen` heading in `docs/how-it-works.md` has no route, so every phase
that removes a route edits that page in the same commit. Before deleting any
export, grep `src/` and `e2e/` for it; the audit's claims are from
2026-09-29 and the tree moves.

### Phase 1 — Dead code sweep · Sonnet · about 1,100 lines

Pure deletions, each verified by grep, `npm run check` and the existing
tests. No screen changes shape.

- Server: `tasks.moveBlock`; `index.tasksByIds` and the `tasks_id` index;
  the `findTasks` options nobody passes (`tags`, `under`, `paths`,
  `quadrant`, `includeFenced`) and their docstring; `daily.formatDay`,
  `isDailyNote`, `formatMinutes` (importers switch to `$lib/shared/time`);
  `parse/task.startMinutes` and `durationMinutes`; `shared/time.relativeDay`
  (every caller uses the one in `links.ts`); `shared/task.hasTag`;
  `IndexedTask` alias; `last_build_at`; `config.dailyNote.format`; the
  unread `headings` table and `notes.hash/frontmatter/bytes`, `links.embed`
  columns, with a `SCHEMA_VERSION` bump.
- `glossary-migration.ts`, its test and the `hub.ts` block. It has run on
  the author's vault. Add one line to `docs/plan-workspaces-v2.md` saying
  glossaries moved to `Glossaries/` on 2026-09-29.
- Anki export: `study/anki.ts`, its test, `client/study.ankiDeckUrl`, the
  GET branch of `api/study/card`.
- Endpoints with no caller: `api/events`, `api/health`, `api/sync/pending`,
  `api/ai/pending` and `ai/pending.ts`, `GET api/ai/settings`,
  `client/ai.dismissProposal`. The `move` edit kind and guardrail five's
  rename rule; add a `default` refusal arm to `proposal.resolve`.
- UI: `components/board/TaskRow.svelte` (two importers switch to
  `components/TaskRow.svelte`); `PageHeader.svelte` (two pages use `.title`);
  `EmptyState.svelte` inlined as `.empty`; `StartMeeting.svelte` (goes with
  phase 2 anyway); the twelve unreferenced icon glyphs; `lib/index.ts`;
  `Proposal.svelte`'s `onedit` path; `Draft.svelte`'s `compact` prop;
  `TodayView.formatEventTime`; `shortcuts.Shortcut.group`.
- `@sveltejs/adapter-auto` from devDependencies.
- `static/manifest.webmanifest`: the Search shortcut points at `/search`
  and the share target at `/share`; neither route exists. Point Search at
  `/notes` and the share action at `/today`, which already reads the
  `share_*` parameters.
- De-export the internal types and constants listed in the audit
  (`Spend`, `ToolPolicy`, `PolicyContext`, `AuditEntry`, `normalise`, the
  `*_FOLDER` constants, and so on). Zero lines, half the public surface.

### Phase 2 — Remove Meetings and four AI features · Sonnet · about 3,300 lines

Ask the author to confirm decision 4's cut of the glossary scan before
starting. Then delete, in this order so each step compiles:

- `src/routes/meetings/**`, `server/meetings.ts`, `parse/meeting.ts`,
  `parse/meeting-map.ts`, `ai/meeting-drafts.ts`, `shared/meetings.ts`,
  `client/meetings.ts`, `components/StartMeeting.svelte`, the Meetings
  entry in `modules/index.ts` and its palette key `m`, `e2e/meetings.spec.ts`
  and `e2e/fixtures/meetings.mjs`, the `## Meetings` section of
  `docs/how-it-works.md`. `Workspace.meetings` and the `meetings: true` key
  stop being read. `today.ts` stops linking an event to a meeting card.
  `calendar.ts` stays; events still draw on the timeline.
- Glossary scan: `components/GlossaryScan.svelte`, `FolderEditor.svelte` if
  it has no other importer, the scan half of `ai/glossary-drafts.ts` (keep
  `lookupPrompt`, `lookupProposal`, `groundTerms`), `sources:` and
  `scanned:` handling in `glossary.ts` and `parse/glossary.ts`, the scan
  branch of `api/ai/suggest`, and its e2e. The keys stay harmless in
  existing files.
- Make cards: `ai/suggest-cards.ts`, `routes/study/[subject]/make/**`, the
  cards branch of `api/ai/suggest`, `components/CardReview.svelte` only if
  it is the SM2 session (it is; keep it), and the "Make cards with Claude"
  hint on the subject page.
- File capture: `ai/file-capture.ts`, the capture arm of `policyFor`, the
  `rewrite-task` edit kind, `Drafted.candidates`, `Draft.svelte`'s
  candidates hint.
- Settings page loses the rows for removed features. `_hub/ai.md`'s
  `features:` entries for them are ignored, not deleted.

Move the `runDraft` runner, `gather`, `words`, `strings` and `NOTE_CHARS`
out of the deleted `meeting-drafts.ts` into `ai/run.ts` first; glossary
look-up imports them today.

### Phase 3 — One AI runner, read-only always · Opus · about −500 lines

Design it twice: sketch `run.ts` as (a) one `runDraft(feature, prompt,
schema?)` returning text or validated JSON, and (b) a class per feature; say
in the merge message why (a) wins. Then:

- Fold briefing and Date insights onto the runner. Both build the same
  stamp, log closure, kill-switch and budget checks by hand today.
- Remove `PERMISSION_MODES` propose and apply, `sandbox.makeSandbox` and
  `readSandboxChanges`, the tool branches of `toolPolicyFor`,
  `requireSandboxRoot` and `buildArgs`, the settings column and the
  `render()` prose that describes them, and their tests. Keep
  `requireSandboxRoot`'s "cwd is not inside the vault" assertion and the
  whole `NEVER` list.
- Remove `briefingException` and rewrite `briefing.test.ts`'s
  `accepted: []` cases as ticked-id cases.
- Log the effective mode (`read-only`), not the configured one.
- Call `pruneSnapshots` after `snapshot` so the seven-day promise on the
  settings page is true, or delete both.
- Remove `maxConcurrent` and `Spend.running`; nothing passes a count.
- Wrap `briefing.openerPrompt`'s task text in `wrapAsData` (a guardrail
  eight gap, not a cut).
- `cli.ts`: drop `parseMaybe`, the bare-string and `cost_usd` tolerances and
  the `envelopeError` re-parse; the CLI returns `structured_output` under
  `--json-schema` and the two text callers never read `.json`.
- README "The AI layer": delete the "one exception" paragraph and the
  per-feature permission-mode sentence; the ten guardrails become nine
  plus "read-only, always".

### Phase 4 — One transport, one route shape, one loader per fact · Opus · about −700 lines

Design it twice for each of the three; the alternatives are in the audit.

- `client/api.ts` becomes one `api<T>(path, body?, { method })` returning
  `Result<T>` with the raw body on failure. The 28 one-line wrappers and
  nine copies of try/fetch/json/409 collapse into it; keep named functions
  only where they map or locate (`applyShift`, `locate`, the board and
  reading pickers). One 409 sentence.
- A `route(handler)` wrapper in `routes/api/` that parses JSON, awaits the
  hub, and maps `Result` reasons to statuses from one table. The 34
  handlers become the one line each of them was meant to be. Domain logic
  now in `api/palette`, `api/card` and `api/ai/suggest` moves into the
  module it belongs to.
- `hub()` returns the ready instance; the 74 `hub(); await ready;` pairs go.
- `hub().workspace(slug)` replaces 19 inline finds. `renderNote(index, md)`
  in `$server/render` replaces six `resolveLink` closures.
- `study/[subject]/+layout.server.ts` computes `studySummary` once; five
  tabs stop recomputing it. `today/` and `today/[day]` become
  `today/[[day]]`. `w/[slug]/+layout.server.ts` reads Inbox, Log and Pages
  once for its children.
- Move `shared/geometry.ts`, `layout.ts`, `breadcrumb.ts` to `client/`;
  only the browser imports them.

### Phase 5 — One stylesheet · Sonnet · about −300 lines net

Add to `app.css`: `.dot`, `.box`, `.modal` (dialog plus backdrop), `.drag-
ghost`, `.link`, `.x`, `.add-row`, and make `.empty` the only empty state.
Then delete the per-component copies: the colour dot in 14 files, the
checkbox in 5, the dialog shell in 3, `.drag-ghost` in 2, `.problem`
overrides in 19, restyled inputs in 6 that should be `class="field"`, the
small-caps `h3` in 4, the two identical review empty states. `Timeline`,
`TodayView` and `CardDrawer` lose their accidental bits from the audit
(`TimelineEvent` duplicating `TodayEvent`, the busy-set duplication,
`CardDrawer.href` reimplementing `noteHref`). `shortcuts.svelte.ts` becomes
single-registrant. `docs/design.md` names each new class; the token test
proves the page and the sheet agree.

### Phase 6 — Today plans the day and reads the inbox · Opus · adds about 450 lines, removes about 150

- **Create today's note.** When `dailyNotePath(today)` is absent, the empty
  state names the path and offers "Create today's note". One click copies
  `Journal/Journal Template.md` byte for byte to that path through the vault
  module and returns the note; nothing else creates it. The `no-note` reason
  in `day-plan.ts` and the briefing keep refusing when it is absent.
- **Board cards onto the timeline.** Each card under "From your workspaces"
  gets the same ⠿ grip the unscheduled list has. Dropping on the timeline
  calls `planOnDay` with a `TaskRef` to the card's line in `Board.md` and the
  dropped time; the block lands under `# Tasks` and the card stays on its
  board. Dropping on the unscheduled list plans it without a time.
  `Timeline.svelte`'s drop handling already distinguishes the two zones.
- **Capture routes by what you type.** `capture.ts` reads the line once
  with the board's quick-add grammar: a line with a time range goes into
  today's note under `# Tasks`; a line with `#ws/<slug>` or an alias word
  goes onto that board's first column; everything else lands in
  `Inbox/Capture.md` under today's heading, as now. Every box, the `c` and
  `k` keys and the share sheet call the same function. Update the
  `how-it-works.md` sentence that claims a capture is immediately
  schedulable; after this it is.
- **Today reads the inbox.** An "Inbox" card on Today lists the unfiled
  lines of `Inbox/Capture.md`, newest first, capped at five with a count
  and a link to the triage page. `listInboxLines` and `openInboxCount`
  already read the file; `today.ts` gains one card and `today.server.ts`
  nothing, because the inbox is not a module. The card is hidden at zero.
- **Triage page** at `/inbox`, one row per unfiled line in file order,
  newest day first. Three actions per row, each also a key when the row
  is focused: `t` plans it onto today through `planOnDay` (a bare bullet
  is written as a task line first, the way "Make it a task" reads it);
  `b` files it as a card on a board chosen from a picker of the
  workspaces, through `fileInboxLine`; `x` ticks the line. All three tick
  the inbox line in place, so the file stays a record and the row leaves
  the list. Nothing is deleted. The route joins `SYSTEM` in
  `modules/index.ts` (**default**: not a rail tab; reached from the Today
  card, the palette key `i`, and the evening review).
- **Workspace Inbox tab** shows the same triage list filtered to lines
  carrying the workspace's tag or an alias word, and its capture box
  writes to `Inbox/Capture.md` with the tag appended. `inbox.ts` stops
  reading `<home>/Inbox.md`; the Today workspace card's inbox count comes
  from the filtered list instead. An existing `<home>/Inbox.md` is still
  listed read-only under the tab until it is empty (**default**).
- `WeekBars` moves from Study to Today: seven columns of done against
  planned, from the seven daily notes. The README already calls Today "the
  day and the week around it".

### Phase 7 — Evening review · Opus · adds about 350 lines

A route `today/[[day]]/review` and a phone tab-bar slot replacing the one
Meetings held. It lists every task line of the day's note in note order,
timed blocks first as the timeline does, each with a tick, a skipped mark
and the workspace dot. Tick and skipped are the existing single-line rewrite
in `tasks.ts` with the expected raw line for conflict detection; skipped
writes `- [-]`. `parse/task.ts` learns `[-]` as a third state, rendered
struck through everywhere a task is shown, and `vault-conformance.test.ts`
proves the bytes survive. A count at the top, "done 4, skipped 2, open 3",
is the same summary line Today shows, and the screen ends with "N in the
inbox" linking to `/inbox`, so inbox zero is part of closing the day. A
"Review the day" link appears on Today from 18:00 (**default**), and the
palette gets `r`. Nothing is written without a tap; there is no auto-tick.

### Phase 8 — Anki's scheduler through ts-fsrs · Opus · about +120 −150 lines

Add `ts-fsrs` (MIT, maintained by the Open Spaced Repetition group that
maintains FSRS itself) as the one scheduling dependency, and delete
`shared/sm2.ts` and its `OSR` rules, `NEW_INTERVAL`, `SchedulingRules` and
the `rules` parameter. Design it twice: (a) call `ts-fsrs` directly from
`flashcards.ts`, or (b) wrap it in `shared/scheduler.ts` with one function
`grade(card, grade, now)` returning the next state and a label for each of
the four buttons. Pick (b) so the comment grammar and the library are in
one file each, and say so in the merge message.

State per card side is what FSRS needs and nothing else: due, stability,
difficulty, reps, lapses, state (new, learning, review, relearning), last
review. It is written in one comment prosoche owns, one per card side, in
the position the SR comment occupies today, with numbers rounded so a file
is stable across reviews:

    <!--fsrs:2026-10-02,3.21,5.8,4,0,review,2026-09-29!2026-10-01,1.02,6.3,1,0,learning,2026-09-29-->

`flashcards.ts` reads a legacy `<!--SR:…-->` as a review-state card whose
stability is its interval and whose difficulty is derived from its ease,
and rewrites it in the new form on the card's next grade only, so
`vault-conformance.test.ts` proves an unreviewed file is untouched.
`glossary-cards.ts` writes no comment for a new card, as today. Default
FSRS parameters and a desired retention of 0.9 (**default**); both live in
`config.ts`, not in the vault, because they are the app's tuning rather
than the user's data. The review log FSRS would need to optimise
parameters per user is not kept (**default**: a later phase can append one
line per review to the card file if the author wants tuning).
`CardReview.svelte` shows the four buttons with the intervals `ts-fsrs`
returns. `docs/how-it-works.md` says the Obsidian plugin no longer
maintains these cards and names FSRS. The plugin's `data.json` is left
alone. `isDue`, `intervalLabel`, `addDays` and `daysBetween` from `sm2.ts`
move to `shared/time.ts` if anything still needs them.

### Phase 9 — Docs for a new user · Sonnet · about −100 lines

- `docs/getting-started.md`, ten steps: run it, set Obsidian daily notes to
  `Journal` with `YYYY/MM/DD` and the template, put `# Tasks` in the
  template with a timed line, open today or press Create, drag a grip onto
  the timeline, `Q1` in backticks is priority, `#ws/slug` or an alias files
  a task, `c` captures and `mod+k` searches, `i` triages the inbox,
  workspaces are files in `_hub/workspaces/`, review the day at `r`.
- README: keep what it is, the daily-note example, Running it, and a link
  to getting started. Move Tests and How it is put together to
  `docs/contributing.md`. Modules become one line each; the AI section
  becomes one paragraph.
- `how-it-works.md`: remove the Meetings and Make cards sections, update
  Today, Glossary, Study and Settings for phases 2 to 8. The test keeps the
  headings honest.
- The Today empty state shows the task line grammar in a code block, and
  the Study create form names `Study/<name>/Flashcards/`.

## Handing a phase to an agent

Give the agent this file, CLAUDE.md, and the phase heading. Ask it to grep
before it deletes, to keep `how-it-works.test.ts` green in the same commit as
any route change, to run the checks listed at the top of Phases, and to
report lines removed against the estimate. A phase that finds the estimate
wrong by more than half reports why before continuing.
