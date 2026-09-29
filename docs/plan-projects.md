# Plan: a home for each project

Written 2026-09-23 from a usability audit of the live app and an interview
with the author. Follows `docs/plan-workspaces.md`, whose phases are merged.
Each phase is a branch merged to `main` with `--no-ff` once `npm test`,
`npm run check` and `npm run e2e` pass, then deployed with `npm run build`
and `systemctl --user restart prosoche.service`. Every phase updates
`docs/how-it-works.md`.

## Goal

prosoche is where the author organises the thoughts, notes, tasks and
progress of each project. Obsidian stays for long writing: the monthly
journal, canvases, Excalidraw. Everything else starts here.

## Why it is not used yet

Measured on 2026-09-23 against the vault and its git history.

- **Trust.** `Journal/2026/09/22.md` holds git conflict markers and two
  empty `## Briefing` blocks. On the 22nd, Obsidian and the app each created
  that day's note, then the notes were synced through git. Four things move
  this vault: Obsidian Sync, Syncthing, Obsidian Git and the app's git sync.
- **Mornings start at a dead end.** Obsidian opens today's note on launch
  (`openBehavior: daily`). Today in the app says "No note for this day yet"
  and waits for a click. The briefing arrives on Review as a diff of two
  HTML comments rather than as a briefing.
- **Every project screen is empty.** On eye2gene: 0 cards, 0 people, 0
  minutes, even though a 7½-hour eye2gene block sat on the 22nd. The
  workspace has no `aliases:`, nothing is tagged, and the Board's only offer
  is 414 lines of a manual test plan.
- **Thoughts have nowhere to go.** The author said project thoughts end up
  in the monthly journal, the timesheet, or nowhere. The app has one global
  `Inbox/Capture.md` and no per-project log.
- **Share of the work.** Since the 21st the app wrote roughly 5–10% of the
  lines the author changed. Since the 22nd it has written only its own logs.

## Decisions from the interview

| Question | Answer |
|---|---|
| First thing on a project | An **Overview** page |
| What progress means | **Tasks done** and **written updates** |
| Overview sections | Next actions, inbox, latest update with done-this-week, blockers, recent notes |
| Where updates live | `<project folder>/Log.md`, a dated heading per session |
| When to ask for an update | **When a project block is ticked on Today**, and a form on the Overview |
| Where captures land | `<project folder>/Inbox.md`, triaged later |
| Where tasks live | The project's `Tasks.md`, which the board already reads |
| AI on a project | **Triage the inbox**, and a **weekly project summary** |
| Empty widgets and tabs | **Hidden until they have data** (this replaces the old rule "tabs show counts, never hidden") |
| Devices | Mac Obsidian plus this server; nothing else writes the vault |
| Sync | **Git only**: Obsidian Git on the Mac, the app's git on the server |
| Daily note | **The server creates it at 00:05** from the template |
| Pilot project | **eye2gene** |
| Order after projects | Planning, then Study, then CRM |
| Obsidian's role | Long writing only, so editor parity (vim, image paste) is out of scope |
| Vault edits in this plan | Shown as a diff; applied only when the author says "apply" |

## Ground rules

These come from `CLAUDE.md`:

- Markdown is the only truth.
- Preserve every byte the user did not change.
- Task edits go through `rewriteTaskLine` spans. Appends go through
  `appendUnderHeading`.
- Filesystem calls only in `src/lib/server/vault/`. SQL only in
  `src/lib/server/index/`.
- A model never writes without an accept step.

The app never edits `Journal/Journal Template.md` or `_hub/workspaces/*.md`
on its own. Changes to them are proposed as diffs. Nothing here changes the
task-line grammar.

---

## Phase 0: trust (half a day)

**0a. Commit the transient-state fix already in the tree.** `git-sync.ts`
drops `_hub/.state/*` and `_hub/timer.json` even when a caller names them.
The test is written; commit it as its own change.

**0b. The server creates the day's note at 00:05.**

- Add a third job to `src/lib/server/ai/schedule.ts` next to the briefing
  and weekly review, with the same rules for missed runs.
  - It calls `openDay` for today, which copies the template byte for byte,
    and it commits.
  - If the note exists, it does nothing.
- If the Mac also creates the note from the same template before it pulls,
  git sees two identical additions and merges them without a conflict. A
  conflict is only possible once one side has edited, which is why 00:05
  is safe.
- Today for the current day then never shows the "No note yet" state. The
  button stays for future days.
- Tests: the job creates exactly the template bytes; a second run is a
  no-op; running after a missed night creates only today.

**0c. Briefing markers are written once and stay out of Review.**

- The 22nd has two `## Briefing` blocks because the marker append ran on
  both sides of a merge.
- `briefing.ts` should look for the start marker anywhere in the note, not
  just in its own region, before it proposes adding markers.
- Propose one diff to `Journal/Journal Template.md` that adds the markers to
  the template. After that, every server-created note has them, and the
  briefing fills its region at 07:00 with no Review step. That is the
  exception `weekly-review.ts` already describes.

**0d. Vault fixes, shown first and applied only on "apply".**

- In `Journal/2026/09/22.md`: remove the conflict markers, keep both
  `## Time log` lines, and delete the second empty Briefing block.
- Apply `/tmp/prosoche-vault-proposal.patch`: `aliases:` for each workspace
  (for example `[eye2gene, e2g]`), Overview tabs, and template markers.
  Regenerate it if the vault has moved on since.
- Add the Overview tab from phase 1 to `_hub/workspaces/eye2gene.md`.

**0e. Mac-side checklist.** The author does these; the plan only lists
them.

- Turn Obsidian Sync off for this vault.
- Remove the vault folder from Syncthing. `.stfolder` and `.stversions` can
  then be deleted.
- In Obsidian Git, turn on "Pull on startup". Keep auto-commit and pull at
  10 minutes.

**Done when:**

- Opening Today at 08:00 shows the day's tasks, with no click.
- `grep -rn '^<<<<<<<' ~/vault --include=*.md` is empty.
- eye2gene → Time shows yesterday's block.

---

## Phase 1: the project Overview (1–2 days, eye2gene first)

Design twice:

- **(A)** A dedicated Overview route, with its own loader, outside the
  widget catalogue.
- **(B)** New widgets composed on an ordinary tab named Overview.

Pick **B**. Tabs are already declared in the workspace file, widgets already
fail independently, and the other five workspaces get the Overview by
naming widgets rather than by a code change. What (B) costs: the widgets
must agree on "this week", so they share the same day helpers from
`daily.ts`.

New widgets, each a file under `src/lib/server/widgets/` with a matching
Svelte file:

| Widget | Shows | Reads |
|---|---|---|
| `next` | Up to 5 open cards: In progress first, then To do by quadrant and due date, and a "Schedule" button that uses `addToDay` | `openCards` in `board.ts` |
| `inbox` (scoped) | Open lines of `<folder>/Inbox.md` with Task / Note / Discard buttons (phase 2) | Existing `inbox.ts`, gains a workspace scope |
| `progress` | The latest `Log.md` entry, tasks done this week and a four-week count trend, with a "Write update" button | `project-log.ts` (phase 3), the index |
| `blockers` | Cards in the Blocked column, `Blocked:` lines from the latest update, and dependency blocks | `blocked.ts`, `project-log.ts` |
| `notes` (existing) | The 5 most recently edited notes in the project folders | `recentNotes` |

- `TEMPLATE_TABS.project` and `.business` become
  `Overview: [next, inbox, progress, blockers, notes]`, followed by Board,
  Notes, People and Insights.
- Existing workspace files change only through the 0d diff.
- The Board tab stops listing every checklist line as "Promote a line to a
  card".
  - Promotion becomes a search box: type a few words, then promote the
    match.
  - The 414-line wall goes.
- e2e in `08-workspaces.spec.ts`: an Overview with the fixture's cards shows
  them in order; an empty project shows one "Add your first task" line and
  no empty cards.

**Done when:** opening eye2gene answers "what's next, what's waiting on me,
what did I do last" without a scroll on a 900px-tall screen.

---

## Phase 2: capture into a project, triage later (1 day)

**Where a capture goes.** Extend `capture()`:

```ts
capture(vault, text, { workspace?: Workspace | null, now? })
```

- With a workspace, the line goes to `<first folder>/Inbox.md`, under the
  same day heading `appendUnderDay` writes.
- Without one, it goes to `Inbox/Capture.md` as now, and those lines show on
  Today.

**How a workspace is chosen**, in this order:

1. The page you are on. `c` on `/w/eye2gene` captures there.
2. A leading `e2g:` or `#ws/eye2gene`, matched against name, slug and
   aliases. The prefix is stripped.
3. A project picker in the capture dialog, with "No project" as the default.

**What a captured line looks like.** Design twice:

- **(A)** A plain `- ` bullet with the capture time, as now.
- **(B)** An open checkbox, `- [ ] <text>`, with no time in front.

Pick **B**. Triage is then a checkbox change through `rewriteTaskLine`: `[x]`
means filed, `[-]` means discarded. That needs no new edit kind, and the
edit is still one line. The time is dropped because `HH:MM text` would parse
as a time block; the day heading already dates the line. The global capture
file keeps its current shape.

**Triage buttons** on the Overview's inbox:

| Button | What it does |
|---|---|
| **Task** | `createCard` into `Tasks.md`, then ticks the inbox line |
| **Note** | Picks a note in the project (recent notes first), `appendUnderHeading` there, then ticks the inbox line |
| **Discard** | Marks the line `[-]` |

**AI triage.** "Suggest" on the inbox widget calls an extension of
`ai/file-capture.ts`.

- It proposes, for each open line, task / note (naming which note) /
  discard.
- The proposal is a list of the same edits the buttons make, and each one
  can be accepted on its own.

**Tests:**

- `capture.test.ts`: routing by page, prefix and alias.
- Triage keeps every other byte of `Inbox.md` unchanged.
- e2e: capture on a workspace page, promote it to a card, and check the
  bytes of both files.

---

## Phase 3: session updates in `Log.md` (1 day)

New module `src/lib/server/project-log.ts`. Its contract comment is written
before its body.

```ts
appendUpdate(vault, workspace, { day, did, next, blocked }): Promise<Result>
latestUpdates(vault, workspace, n): Promise<Update[]>
```

- The file is `<first folder>/Log.md`. It is created with a `# <name> log`
  heading if it does not exist.
- Newest entries go at the bottom, so the file is only ever appended to and
  reads naturally in Obsidian.
- One `## YYYY-MM-DD` heading per day. A second update the same day appends
  under the existing heading.
- An empty field is left out.
- Never rewrites an existing line.

The shape on disk:

```markdown
## 2026-09-23
- Did: permissions regression pass on the data portal
- Next: fix the reset-project dialog
- Blocked: waiting on QMS sign-off
```

- On the update form, a "Next" line can also be sent to the board as a card
  in one click. That uses `createCard`, and the log line stays as written.
- **The nudge.** Ticking a timed block on Today that belongs to a workspace
  opens a small inline did / next / blocked box under the block. The block
  belongs to a workspace by tag or alias, using the same match the Time
  widget uses.
  - The box is never a modal. Esc or "Skip" closes it.
  - It appears once per block per day.
- The same form sits behind "Write update" on the Overview.
- The eye2gene timesheet is untouched: `TIMESHEET <MONTH>.md` keeps its own
  format and tab.

**Tests:**

- Table tests for `appendUpdate`: new file, new day, same day, empty
  fields, a file the author edited by hand.
- e2e: tick a block, write an update, and check `Log.md`.

---

## Phase 4: less noise (1 day)

- **Empty is hidden.**
  - A tab whose count is 0 is not shown.
  - A widget whose data is empty collapses to nothing.
  - A workspace where everything is empty shows one line: "Nothing here yet —
    add a task or capture a thought".
  - Update `docs/how-it-works.md` and `plan-workspaces.md`, which state the
    old rule.
- **Navigation.**
  - Review and Sync leave the sidebar. The top-bar status badge shows
    pending proposals and sync state, and links to both.
  - Ask's model, effort and budget controls move behind one "Settings"
    disclosure.
- **Today.**
  - The "Elsewhere" list stops repeating tasks already on the timeline.
  - The unexplained day badge ("02") becomes "since Tue", or goes.
- **Study.**
  - Habits show nothing rather than "0 of 0 · All 16".
  - Currently learning shows real progress or no bar.
  - The topic map says "8 topics with notes" rather than "0 of 40 covered ·
    33 gaps".

---

## Phase 5: weekly project summary (1 day)

- Extend `ai/weekly-review.ts` with one section per workspace that had
  activity. Each section covers:
  - tasks done
  - `Log.md` entries for the week
  - cards open longest, and blockers
  - two or three sentences of model commentary
- The figures come from queries; the model only writes the commentary. If
  the model is unavailable, the note is still written with the numbers.
- The Sunday job produces one `create` proposal for the weekly note, as now.
  After it is accepted, the Overview's `progress` widget links "This week's
  summary".
- Open question, settle at the phase: one weekly note with a section per
  project (the current design), or a note per project under
  `<folder>/Weekly/`.

---

## Phase 6: daily planning (1–2 days)

- **Plan my day** on Today.
  - Untimed tasks from the template are listed with the time each had on the
    most recent day that timed it.
  - "Use these times" writes each one as a single-line span edit. Each row
    can be adjusted by drag, as now.
  - This replaces the "Set out tasks for the day on obsidian" ritual.
- **Briefing inline.** The 07:00 briefing renders at the top of Today (it
  already sits in the note after 0c), and can be collapsed.
- **Next actions on Today.** The "From your workspaces" card shows each
  project's `next` widget, one line per project.
- **Timeline.**
  - A block longer than 3 hours draws compressed, with a break marker, so the
    rest of the day stays visible.
  - The card opens scrolled to now.

---

## Phase 7: study (1–2 days)

- **The 80 Anki exports in `Flashcards/`** (tab-separated, `#deck:` headers)
  are invisible today. Design twice at the start of the phase and ask:
  - **(A)** Show and review them in the app, keeping review state in a
    sidecar markdown note per deck.
  - **(B)** A one-off accepted proposal converts them to Spaced Repetition
    markdown, which the app and Obsidian both read.

  (B) keeps one card format. (A) keeps Anki as the source. This depends on
  whether the author still reviews in Anki.
- Habits, progress bars and topic-map wording are fixed in phase 4. Here,
  only what phase 4 did not cover.

---

## Phase 8: people (1–2 days)

- A `/people` list page, which is a 404 today. It shows each person's last
  contact, open follow-ups and workspaces, sorted by who is overdue.
- Seed people from `Journal/Friend List.md` through one accepted proposal
  that creates notes in `People/`. The list stays where it is.
- Follow-ups due today appear on Today.
- The workspace People tab stays hidden until a project has a person
  (phase 4).

---

## Out of scope

- Editor parity: vim mode, image paste, the monthly journal. Obsidian keeps
  long writing.
- Offline use on the phone.
- Any change to the task-line grammar.

## Order and size

| Phase | Size |
|---|---|
| 0 | ½ day |
| 1 | 1–2 days |
| 2 | 1 day |
| 3 | 1 day |
| 4 | 1 day |
| 5 | 1 day |
| 6 | 1–2 days |
| 7 | 1–2 days |
| 8 | 1–2 days |

Phases 1–3 are the project loop and should ship together before anything
else is judged. Phase 4 can run alongside phase 2.
