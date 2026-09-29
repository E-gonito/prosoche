# Plan: workspaces v2 (board, CRM, glossary, master note)

Written 2026-09-29, after an interview with the author. Every decision below is
the author's answer, or a default marked **default**, which stands unless the
author says otherwise.

## What changes

1. **Board.** Each workspace gets a kanban board stored in `<home>/Board.md`.
   It replaces "Next actions" on the Overview and the Tasks tab.
2. **Master note.** Each workspace gets `<home>/Overview.md`, shown on the
   Overview below the board. It renders as markdown; Edit opens a plain
   markdown editor with Save and Cancel.
3. **CRM.** A CRM tab on every workspace replaces the People tab and its deal
   pipeline. One file per contact in `<home>/CRM/<Name>.md`.
4. **Glossary.** Glossary leaves Meetings and becomes its own module in the
   rail, with one subsection per workspace. It uses the same UI as the
   meeting glossary had. It is still stored in `<home>/Glossary.md`.
5. **Meetings opt-in.** A workspace has meetings only if its definition
   says `meetings: true`. For now that is Kaya Thai Therapy, Cusina Ko and
   eye2gene.

`<home>` is a workspace's first folder, as before.

## Board

**Format: the Obsidian Kanban plugin's**, so the same file opens as a board
in Obsidian if the plugin is installed, and stays readable as a checklist if
not. It is not installed today. Match the plugin's own serialiser, taken from
its source (github.com/mgmeyers/obsidian-kanban), not a guess.

```markdown
---

kanban-plugin: basic

---

## To do

- [ ] Order menu printing @{2026-10-03} `Q1` #print
	Two quotes so far; ask Print Co for a third.
- [ ] Call the landlord

## Doing

- [ ] Supplier price sheet @{2026-10-01}

## Done

- [x] Register business name


%% kanban:settings
```
{"kanban-plugin":"basic"}
```
%%
```

- **Columns:** `##` headings. New boards start with To do / Doing / Done.
  Columns can be added, renamed, reordered and deleted in the UI (delete
  only when empty, **default**).
- **Card:** a `- [ ]` item with a title, an optional due date `@{YYYY-MM-DD}`,
  an optional priority `` `Q1` ``–`` `Q4` `` (the daily note's convention),
  labels `#tag`, and notes as indented continuation lines. If the plugin
  writes notes differently (e.g. `<br>`), follow the plugin.
- **Done:** a card ticked in any column is `[x]` and stays where it is.
  Moving a card into the last column does not tick it (**default**).
- **Prosoche is the source of truth for this file.** It is the one place
  where a drag is allowed to move lines: a move cuts the card's lines (item
  plus continuation lines) and splices them in at the target, byte for byte.
  Nothing else in the file is rewritten, so the rest of the file still
  keeps every byte the user didn't change. Edits made in Obsidian still count;
  a stale write returns a conflict, as everywhere else.
- **Interaction:** drag cards within and between columns (mouse and touch).
  Keyboard: a card's menu offers "Move to…". Each column has an inline
  "+ Add card" field. The quick-add parses `due`, `Q1` and `#label` from
  the text you type (e.g. "Call landlord fri Q1 #legal") (**default**:
  natural dates are today, tomorrow, weekday names and `YYYY-MM-DD`).
  Clicking a card opens a drawer to edit title, due date, priority,
  labels and notes.
- **Today:** open cards with a due date show in Rest of the week on their day
  and in Overdue once late. Ticking one on Today ticks it in `Board.md`.
- **Tagged tasks elsewhere** in the vault no longer show in the workspace.
  They stay in their notes, untouched.
- A missing `Board.md` reads as an empty default board, and the first write
  creates the file.

## Master note

- `<home>/Overview.md`. A missing file reads as empty, with a "Write an
  overview" prompt; the first Save creates it.
- Rendered with the app's markdown renderer. Edit swaps in a textarea
  holding the raw file. Save writes the whole file with the usual stale-hash
  check. This is the user's own text, not a re-serialisation, so it is allowed.
- Overview order: board, master note, Inbox and Log, recent notes, and
  Meetings if the workspace has it.

## CRM

For suppliers and vendors, colleagues and stakeholders, and leads. No stage
pipeline and no follow-up reminders; the author didn't ask for either.

```markdown
---
kind: supplier
company: Mang Tomas Foods
role: Sales
email: orders@mangtomas.ph
phone: +44 7700 900123
links:
  - https://mangtomas.ph
---

Pork and chicken supplier. Met at the trade fair.

## History
- 2026-09-29 Asked for a wholesale price list
- 2026-09-22 First call
```

- `<home>/CRM/<Name>.md`, where the file name is the contact's name, so
  `[[Mang Tomas Foods]]` links to it from Obsidian.
- `kind` is one of `supplier`, `stakeholder` or `lead` (**default**; free
  text is still shown if someone types another).
- The CRM tab shows a list you can filter by kind and search, sorted by most
  recent interaction. Its "New contact" form creates the file.
- A contact's page shows editable details (frontmatter, each field a span
  edit), the free notes, and the history, newest first. You can add a dated
  entry, which is inserted under `## History`.
- It is modelled on Date's People screen, but public scope and per
  workspace. None of it touches `Private/`.
- The People tab and the deal pipeline are removed. Existing person notes
  stay in the vault untouched.

## Glossary

- New module `/glossary` in the rail, between Meetings and Workspaces
  (**default**), with sub-items per workspace like the Workspaces entry.
  The list shows workspaces that have a `Glossary.md`, and "Start a
  glossary" creates one for any other workspace (**default**).
- `/glossary/[slug]` is the meeting notebook's glossary screen, moved
  (search, category filter, add a term, statuses, relevance line). The
  format is unchanged (`parse/glossary.ts`).
- Meetings drops its Glossary tab. Capturing a term during a meeting still
  writes to that workspace's `Glossary.md` (**default**).

## Meetings opt-in

- A workspace definition gains `meetings: true`. Without it, the workspace
  has no primer or notebook: it doesn't appear on `/meetings`, its Overview
  has no Meetings section, and calendar mapping doesn't offer it.
- Set it in `_hub/workspaces/{kaya-thai-therapy,cusina-ko,eye2gene}.md`.

## Tabs after the change

Overview · CRM · Inbox · Log · Notes · custom pages. CRM always shows.
Inbox, Log and Notes still hide when empty. Their routes still answer.
Tasks and People go.

## Checks

`npm test` and `npm run check` must pass. The e2e suite can't run on this box
until the missing browser libraries are installed (`sudo npx playwright
install-deps`); new e2e specs are written anyway.
