# Plan: rebuild prosoche as modules

Written 2026-09-29 from an interview with the author and five screenshots of
two Claude artifacts they already use: the eye2gene **Meeting primer &
notebook** and the **Like Ledger**. Work happens on the `rebuild` branch.

This plan replaces the UI and navigation parts of `docs/plan-workspaces.md`
and `docs/plan-projects.md`. Phase 0 of `plan-projects.md` (trust) still
applies and comes first.

## Verdict

**Rebuild the shell and keep the core.** The author dislikes the look, the
navigation and the code, and does not trust or open the app. All four live in
the shell:

- the widget catalogue (18 widgets)
- workspaces built as tabs of widgets
- Review, Ask and Insights as separate destinations
- a design copied from a generic admin mockup

Restyling in place would keep that structure under new colours.

The core is the part that protects the vault, and it is sound:

- `parse/` (task and note grammar)
- `vault/` (filesystem and git sync)
- `index/` (the SQLite cache)
- `sections.ts`
- the model plumbing in `ai/`: CLI, proposals, guardrails, sandbox

These pieces are tested, and `vault-conformance.test.ts` proves the vault
rules against the real vault. Rewriting them in a new stack would mean
proving everything again for no gain. The stack stays SvelteKit and Node.

## Decisions from the interview

| Question | Answer |
|---|---|
| Rebuild scope | New shell and modules; port the core (recommended, accepted) |
| Where | A `rebuild` branch in this repo |
| Devices | Phone and desktop equally |
| Access | As now: the systemd service on this box, over Tailscale or the LAN. No PWA, no native app |
| Look | Warm and personal: paper tones, serif headings, soft colour |
| Today | Computed dashboard for today and the rest of the week; AI briefing only on a button |
| Where week tasks come from | Daily notes, plus each workspace's task list and inbox |
| Calendars | Google now. **Outlook deferred** |
| Meeting primer | One standing card per workspace (`Primer.md`), AI talking points, live notes saved as markdown |
| Glossary | One per workspace; Claude's definitions are proposals until accepted |
| Custom pages | A workspace can embed its own HTML pages from the vault (e.g. Eye 3D) |
| Workspace contents | Tasks or board, CRM (contacts and deals), notes and a dated log, meetings |
| Study | Goals and plan, flashcards, session log and time, reading list |
| Notes | Read-only Obsidian viewer with quick capture |
| Dating tracker | A daily counter ledger (likes sent, matches, your type, likes received, notes), stats and history, plus person profiles with a log entry per date |
| Dating on Today | Never |
| Dating storage | In the vault, under a gitignored `Private/` folder |
| People | One person format everywhere; dating people live under `Private/` and never appear elsewhere |
| Ledger data | Start fresh; no import |
| Future modules | None named, but adding a tab must be cheap |

## Ground rules

The rules in `CLAUDE.md` still apply:

- Markdown is the only truth.
- Preserve every byte the author did not change.
- Filesystem access only in `vault/`, SQL only in `index/`.
- A model never writes without an accept step.

The rebuild adds three rules:

1. **A module talks to the core, never to another module.** Two modules that
   need the same thing push it down into the core.
2. **`Private/` is invisible by default.** Every core read excludes it unless
   the caller asks for private scope, and only the Dating module asks.
3. **Each new line grammar gets one parser.** Deals, glossary entries and
   ledger lines are parsed in `parse/`, table-tested and span-rewritten,
   exactly like tasks.

---

## Architecture

```
src/
  lib/
    server/            core, kept: vault/, parse/, index/, ai/, sections, people, daily
    modules/
      index.ts         the registry: one line per module
      today/           module.ts, server.ts, components/
      meetings/
      workspaces/
      study/
      dating/
      notes/
    ui/                shell and shared components: Rail, TabBar, Card, Sheet, Proposal
  routes/
    (app)/+layout.svelte    the shell
    (app)/today/…           one route folder per module
    (app)/w/[slug]/…
    …
```

### Module interface: designed twice

**A. A static registry of manifests.** Each module exports a manifest:

```ts
{
  id, title, icon, href, order,
  private?,            // true only for dating
  today?(ctx) => TodayCard | null
}
```

Its pages are ordinary SvelteKit routes under `(app)/<id>/`, and
`modules/index.ts` lists the manifests. The shell draws the navigation from
that list. Today asks each module for a card.

**B. Runtime plugins.** Modules are discovered from folders or from a
`_hub/modules.md` in the vault. Each one brings its own router and settings,
and they are loaded dynamically.

**Pick A.** SvelteKit's file routing already gives each module its pages,
loaders and types. A new tab is one folder plus one registry line. B needs a
router, a loader and a config format that nothing needs today, since no
future module is named. If one ever needs vault-side configuration, A can
read it without changing the interface.

### Private scope

- `.gitignore` gains `Private/`.
- `git-sync.ts` refuses to stage anything under `Private/`, even when a
  caller names it. This is the same guard as the transient-state fix in the
  working tree.
- The `Vault` and index reads take `{ scope: 'public' | 'private' }`, and the
  default is `public`. Search, Notes, backlinks, people lists, AI retrieval
  and the briefing never pass `private`.
- A dating AI call gets only dating data in its prompt. Private notes are
  never mixed into general retrieval.
- **Backup.** `Private/` is outside git, so it exists only on this box. The
  author backs up the whole box from the Proxmox host, which covers it.

---

## Vault formats

Nothing existing changes shape. The new files are:

**Workspace home.** `_hub/workspaces/<slug>.md` keeps `name`, `color`,
`tag`, `aliases` and `folders`. `tabs:` and widget lists are dropped: every
workspace gets the same sections, and a section with no data is hidden. The
first folder is the workspace's home:

```
<home>/Tasks.md          board and task list (already read today)
<home>/Inbox.md          captures, triaged later
<home>/Log.md            dated heading per update
<home>/Primer.md         the meeting card, free markdown
<home>/Glossary.md       one heading per term
<home>/Deals.md          one line per deal
<home>/Meetings/2026-09-28 Dev Weekly.md
<home>/Pages/*.html      custom pages, each shown as a tab, sandboxed
```

**Glossary entry.** It mirrors the artifact card: term, my guess, status,
definition, why it matters here, and source.

```markdown
## DVC
- guess:: Data version control, keep track of model output
- status:: looked-up
- category:: ML
- source:: [[2026-09-28 Dev Weekly]]

Open-source tool that versions datasets and models alongside git…

→ For Eye2Gene, DVC makes training data and model artifacts traceable…
```

**Deal line.** It uses Dataview-style inline fields, so it stays readable in
Obsidian.

```markdown
- Moorfields pilot [[Jane Doe]] stage:: proposal value:: 12000 next:: 2026-10-03
```

**Meeting note.** A template creates it when the author presses Start
meeting. The capture box appends one line per item under a fixed heading:

```markdown
## Captured
- term:: Cookie Cutter guess:: something for AI models
- question:: Is the ensemble versioned as one artifact?
- decision:: Deploy to ECS, not Beanstalk
- [ ] action:: Clarify scope with the manager before starting
```

Open actions from every past meeting in the workspace appear under "Before
you go in", as in the artifact. Ticking one rewrites that line.

**Ledger.** `Private/Dating/Ledger.md` holds one line per day. Saving a day
that already has a line rewrites it in place.

```markdown
- 2026-09-29 sent:: 12 matches:: 2 type:: 1 received:: 5 notes:: slow Monday
```

**Dating person.** `Private/Dating/People/<Name>.md` uses the shared person
format, with `app:`, age, place and job in frontmatter, free notes, and a
`## Dates` log:

```markdown
- 2026-09-20 Coffee at Monmouth rating:: 4 cost:: 9 notes:: easy conversation
```

---

## The modules

**Today.**

- The server creates the daily note at 00:05, from `plan-projects.md` 0b.
- It reads the day's tasks with their time blocks.
- It lists overdue items, then the rest of the week one day at a time, from
  future daily notes and workspace `Tasks.md` and `Inbox.md`.
- Today's Google events appear on the timeline, each linking to its primer.
- A **Briefing** button asks Claude for a short read on the day and week.
  The briefing is shown on screen, and written into the note only after
  **Save to note** is pressed.
- Dating contributes nothing.

**Meetings.** This is the artifact, generalised over workspaces.

- **Calendar.** A Google Calendar secret ICS address goes in `.env`. It is
  read-only and needs no OAuth. The author picks an event's workspace once,
  and the choice is remembered by event title. A workspace whose `aliases`
  appear in the title is offered first.
- **Card.** Renders the workspace's `Primer.md`. **Draft with Claude**
  proposes a version from the notes, and the author accepts it.
- **Notes.** Shows "Before you go in" (open actions), Start meeting or Start
  standup, the capture box, and past meetings. Download as markdown is not
  needed, because the notes already are markdown.
- **Prep.** Claude drafts talking points from the primer, the last three
  meetings, open actions and the event. They become a section of the meeting
  note after accept.
- **Glossary.** Filter box and chips (All, Mine, To look up, categories).
  **Look up** has Claude draft the definition and the "why it matters here"
  line, which lands after accept.
- **Custom pages.** Each `Pages/*.html` file is a tab, as the Eye (3D) page
  is in the artifact.

**Workspaces.**

- An overview: next actions, inbox, latest log entry, recent notes.
- Tasks or board, read and edited through the existing task rewriter.
- Log and Inbox, as in `plan-projects.md`.
- CRM: people linked from the workspace's notes, plus `Deals.md` as a
  pipeline grouped by stage. The file itself is never reordered.
- The workspace's meetings, and its notes (read-only).

**Study.**

- Reuses `study/` as it is: topics, resources, flashcards, anki.
- Adds `Goals.md` (goals with milestones and target dates) and a session
  log that shows hours per topic and a streak.
- Flashcard review keeps its own focused screen.

**Dating.** Like Ledger's four views plus the CRM:

- **Log.** A day stepper and ± counters, "Save as a zero day".
- **Stats.** Match rate, type rate, and weekly and monthly trends.
- **History.** Past days, newest first.
- **People.** Profiles by app, and the dates log.
- **Insights.** Claude reads the ledger and the dates log on demand, and
  proposes nothing to the vault.

The module is registered with `private: true`, so nothing from it appears
anywhere else.

**Notes.**

- The existing renderer, file tree, search and backlinks, all read-only.
- A capture box that appends to `Inbox/Capture.md`.
- `Private/` never shows here.

## Look

A static mockup of the shell, Today and a meeting card is approved on phone
and desktop before any component is built. That is how the last refresh went.
The starting direction:

- **Paper and ink.** Background `#f7f3ec`, panels `#fffdf9`, ink `#2a2622`,
  muted `#7a7068`.
- **Serif headings**, self-hosted Source Serif 4. Body text in the system
  sans at 15px.
- **Accents taken from the primer artifact.** Deep teal `#2e6b85` for action
  and sand `#efe6da` for callouts. One warm red for warnings.
- **Few boxes.** Sections are separated by space and small-caps labels, as in
  the artifact, not by bordered cards around everything.
- **Navigation.** Desktop gets a left rail: Today, Meetings, Workspaces (each
  one listed), Study, Dating, Notes. Phone gets a bottom bar with Today,
  Meetings, Workspaces and More.

`docs/design.md` and `src/app.css` are rewritten to match. The design test
that reads both keeps them honest.

## What is kept, what goes

- **Ported:**
  - `parse/`, `vault/`, `index/`
  - `sections.ts`, `daily*.ts`, `people.ts`, `workspaces.ts` (reading only)
  - `render.ts`, `capture.ts`, `tasks.ts`, `board.ts`
  - `study/`
  - `ai/`: `cli`, `proposal`, `pending`, `guardrails`, `sandbox`, `settings`,
    `schedule`, `briefing`
- **Deleted on the branch:** the widget catalogue (`server/widgets/`,
  `components/widgets/`), the widget tabs in workspace files, Review as a
  destination (accept happens where the proposal appears), and the old
  routes as each module replaces them.
- **Parked, not ported:** timer, time log and timesheet (the author edits
  the eye2gene timesheet in Obsidian), habits, GitHub and Linear widgets,
  share, Ask, Insights, weekly review. The code stays in git history.

---

## Phases

Each phase is a series of commits on `rebuild`, and ends with `npm test`,
`npm run check`, `npm run e2e` and `VAULT_PATH=~/vault npm test` passing.

While the branch is in progress, it runs as a second service on port 3101,
so the author can use it daily. `main` keeps serving the old app on 3100.
`rebuild` merges to `main` with `--no-ff` after phase 3, and the service
switches over.

0. **Trust, on `main` first.** Commit the git-sync transient-state fix that
   is already in the tree. Server-created daily note at 00:05
   (`plan-projects.md` 0b).
1. **Shell.**
   - Mockup approved.
   - Tokens, rail and tab bar, module registry.
   - Private scope in `vault/`, `index/` and `git-sync.ts`, with tests.
   - Widget system deleted.
   - The Notes module, which proves the shell end to end.
2. **Today.** Dashboard, week view, Google ICS events, briefing button.
3. **Workspaces.** Overview, tasks and board, inbox, log, CRM with the
   `Deals.md` parser, custom HTML pages. Then merge to `main`.
4. **Meetings.** Primer card, live notes and capture, open actions, prep
   talking points, glossary with its parser and lookups.
5. **Study.** Goals, session log, reading list, flashcards on the new shell.
6. **Dating.** Private folder, ledger parser, Log, Stats, History, People,
   Insights.

## Settled after the plan was written

- **Backups:** the Proxmox host backs up the box, `Private/` included.
- **Parked features:** none are ported. The timesheet is edited in Obsidian.
- **Calendar matching:** a manual pick, remembered by event title.

## Open questions

Each has a default, which is used if the author says nothing.

1. **Standup vs meeting.** Default: the same note template, and a standup
   gets `type: standup` in frontmatter.
2. **Outlook.** Deferred. When it returns, an ICS subscription is tried
   before the Graph API, which may need eye2gene admin consent.
