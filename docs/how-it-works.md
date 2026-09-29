# How it works

The screens keep to one short hint per card, because a paragraph competing
with your actual notes for attention is the wrong trade. The fuller
explanation for anything trimmed from the UI lives here instead — nothing
written about prosoche is lost, only moved. A unit test reads this page and
`src/routes`, so a screen named here and missing there fails `npm test`.

Every tab is a module listed once in `src/lib/modules/index.ts`. The rail on a
desktop, the bottom bar and More sheet on a phone, and the command palette's
Go commands are all drawn from that list, so a new module appears in all of
them at once. A module can nest sub-items under itself in the rail: the
workspaces are listed under Workspaces, and every workspace with a glossary
under Glossary. The workspaces are also listed in the More sheet.

## Today

The dashboard for one day and the week around it. The title names the day
you are looking at — "Tuesday 29 September", "3 days ago" beneath it — with
arrows either side and a jump back to today when you have wandered off it. A
one-line summary counts what the day did and is still owed: done against the
total, time planned, meetings, and anything overdue.

**Daily notes are made in Obsidian, never here.** When the day's note has not
synced yet, Today says so and waits; nothing on this page, the briefing or a
card planned onto a day will create it. Two devices each making the same new
file is the one clash git cannot merge on its own, and Obsidian already makes
the note the moment you open the day.

**Briefing.** Press "Brief me" for a short read on today and the rest of the
week. It is shown on screen as a draft, never written until you press **Save
to note** — the same accept step every AI feature in the app goes through.
Regenerating drafts again over whatever the note already has. If today's note
has no briefing section yet, the first save only adds it; press Brief me
again afterwards to fill it in, because adding a heading to your note is a
change worth seeing on its own before the words that go under it are. If AI
is off, the strip says so plainly and links to Settings rather than offering
a button that would only fail.

**The timeline** is direct manipulation, not a form. Drag a block to move it,
its bottom edge to resize it, or focus one and use the arrow keys. Drag the ⠿
grip beside an unscheduled task to give it a time, and drag a block out onto
the Unscheduled list, press its ✕, or press Backspace on it, to take the time
off again. Everything snaps to ten minutes, and only the time on that line
changes — the note keeps its own order regardless of where the UI displays a
task. Your Google Calendar events for the day sit on the same grid as sand
blocks rather than teal ones, read-only, each linking to its card on
Meetings. On a phone, a segmented control switches between the timeline and
the plain list; the choice is remembered on that device.

Capture appends to `Inbox/Capture.md` under today's date. A line written as a
task stays a task, so a captured to-do is immediately schedulable rather than
needing to be retyped later. The unscheduled list is exactly what it says:
once a task gets a time, from the grip or the timeline, it moves to the
timeline and leaves this list.

**Overdue** lists two kinds of thing whose due date has passed. First the
open cards on any workspace's board, each with its workspace's dot; tick one
and it is ticked in that board's `Board.md`. Then open tasks from anywhere
else in the vault with a Tasks-plugin due date, daily notes excluded, because
each of those is a copy of your template and would otherwise repeat the same
unfinished checklist; each of those rows has a button to plan it onto today.

**Rest of the week** runs from tomorrow through the coming Sunday, padded out
to six days on a short week. Each day lists its calendar events, the open
tasks already in that day's own note if one exists, and the board cards due
that day, which can be ticked from there; clicking anywhere else on the day
opens its own dashboard.

**From your workspaces** shows each workspace's most urgent open board cards
— priority first, then the soonest due date — collapsed beyond the first
three, plus how many captures are waiting untriaged in its inbox. A card's
title opens its workspace, where the board is; its checkbox ticks it in
`Board.md`. A card on a board is not planned onto the day from here: the
board is where it moves.

Beyond that, any module may add a card of its own — Study offers one for
flashcards due, once something is. A private module never does: nothing of
Date's appears here, or anywhere outside its own screen.

A note that still has git conflict markers in it says so, with a link to the
sync page. Resolving a merge is yours to do, in Obsidian or there; nothing in
the app rewrites those lines for you.

## Meetings

Meetings is a notebook per workspace: a card to read before you go in, and a
place to capture what you don't know while you're there. Everything it keeps
is markdown in the workspace's home folder (its first folder).

Meetings are opt-in. Only a workspace whose definition in `_hub/workspaces/`
says `meetings: true` has a notebook; absent, or any other value, means none.
A workspace without it is not listed on the Meetings page, is never offered
or suggested when you pick a calendar event's workspace, has no Meetings
section on its Overview, and its `/meetings/<slug>` answers 404 with a note
saying which file to add the line to. Its glossary, its pages and everything
else it has are unaffected. Adding the line is the whole of switching it on:
the notebook's files are made the first time you use them.

- `Primer.md` is the meeting card. Write it in Obsidian, or press **Draft a
  primer with Claude**; once it exists, **Suggest updates** proposes a
  revised version. The card draws the note the way it is written: the
  opening paragraph on its own, a `>` quote as a sand aside (a bold first
  word becomes its lead-in), each `##` heading as a section label, a bullet
  list as rows with any nested bullet as the muted line under its row, and a
  numbered list as a set of frames.
- `Meetings/YYYY-MM-DD Title.md` is one meeting. **Start meeting** or **Start
  standup** creates it from a small template (`type`, `date`, the calendar
  `event` and `attendees` when it came from one, and a `## Captured`
  heading). The capture box adds one line under that heading per item:
  `- term:: DVC`, `- question:: …`,
  `- decision:: …`, `- [ ] action:: …`, or `- …` for a plain note. **End
  meeting** writes one `ended: HH:MM` line into the frontmatter. The meeting
  under way is today's latest note without `ended:`.
- "Before you go in" lists every open task line from the workspace's meeting
  notes. Ticking one rewrites that line and nothing else, as ticking a task
  anywhere does.
- A term you capture also goes into the workspace's glossary, `Glossary.md`,
  as an entry to look up with the meeting as its source, unless the glossary
  already has it. The meeting note is the record, so the capture counts even
  if that second write loses to an edit made elsewhere; the term then waits
  on the Glossary page instead (see Glossary below).
- `Pages/*.html` are the workspace's own pages. Each gets a tab in the
  notebook.

Every Claude button here (the primer and **Prep with Claude**) shows its
proposal as a diff first and writes only the file it names, and
only when you accept. **Prep with Claude** adds a `## Talking points`
section to the meeting under way, drafted from the primer, the last three
meetings, the open actions and the calendar event. With no meeting under
way, it proposes the new meeting note with the talking points already in
it, so accepting the prep also starts the meeting.

The Meetings page lists today's and the next seven days' calendar events.
Pick an event's workspace once and it is remembered by the event's title in
`_hub/meetings.md`, one line per title (`- Dev Weekly Meeting → eye2gene`),
which you can edit in Obsidian. A workspace whose alias appears in the title
is offered first but never applied without a click. An assigned event has
**Prep**, which opens its notebook ready to start it, and **Start**, which
starts the meeting at once. Nothing from the private folder is ever read
here.

The calendar is Google's, read through its secret iCal address, so no
sign-in is needed: in Google Calendar open Settings, choose your calendar,
then Integrate calendar, copy "Secret address in iCal format", and set it as
`HUB_GCAL_ICS` in the server's environment. Treat that address like a
password. Without it the page still works: open a notebook and start a
meeting by hand. Outlook calendars are not supported yet.

## Glossary

Glossary is a glossary per workspace: each term, what it means, and why it
matters there. Any
workspace with a folder can have one, meetings or not. It is one file,
`Glossary.md` in the workspace's home folder, so it is the same glossary a
meeting's captured terms go into.

The Glossary page lists each workspace that has one, with how many terms it
holds and how many are still to look up, and offers **Start a glossary** for
every other workspace, which writes a `Glossary.md` holding only a
`# Glossary` title. In the rail each glossary is a sub-item under Glossary.
The notebook's old address, `/meetings/<slug>/glossary`, redirects to
`/glossary/<slug>`.

`Glossary.md` holds one `##` heading per term, with `- status::` (`to-look-up` or `looked-up`), `- category::` and `- source::`
lines, then the definition, then a line starting `→` saying why the term
matters in this workspace. Text above the first heading is yours and is
never touched.

A workspace's glossary page has a filter box and a row of tabs: **All**, one
per category with its count, and **To look up** while any are still waiting.
Each entry shows its category, the definition, where it came from and the `→`
line. There is no "my guess": a `- guess::` line written by an older version
is left in the file and not shown. Type a term in (with a category if you
like) to append an entry to look up; a term the glossary already has is
refused rather than written twice. In a workspace with meetings, any term
captured in a meeting that the glossary still lacks waits at the top, and
**Add to glossary** appends an entry for it. **Start a meeting**, beside the
title, goes to the workspace's meeting notes (see Meetings).

**Look up with Claude** drafts the definition and the `→` line, and marks the
entry looked up with `- drafted:: Claude`; **Look up all** does every waiting
term in one proposal. The context is the primer and the last three meetings
when the workspace has a notebook, and its definition file when it does not.
Like every Claude button, it shows its proposal as a diff first and writes
only `Glossary.md`, and only when you accept.

## Notes

Notes are read-only here: Obsidian is the editor. The list page searches the
whole vault, shows what changed recently, and offers the folder tree. A note
shows its rendered text beside its properties, tags, the notes that link to
it and the notes it links to; Browse opens the folder tree as a side sheet.

The capture box appends one line to `Inbox/Capture.md` under a `## <day>`
heading. A line that is already a task is kept as written; anything else is
stamped with the time. That file is the only thing the Notes module writes.

Suggest cards drafts flashcards from the open note. The draft is shown as a
diff and nothing reaches the note until you accept it.

The private folder, `Private/`, never appears here: not in search, the tree,
backlinks or recent notes. A link straight to a private note is a 404.

## Study

Study is scoped to the workspace whose `template:` says `study` — the `Study`
workspace in a fresh vault — or the whole vault when there is none. Its own
notes, `Goals.md` and `Sessions.md`, live in that workspace's first folder.
Its tabs are Overview, Goals, Sessions, Flashcards and Reading list; a tab
other than Overview hides itself until its note has something in it.

**Overview** shows what to review right now with a button straight into a
session, each goal's milestones done out of its total and what is next, this
week's time against a `weekly_hours:` target, the streak of consecutive days
with a session logged, what you are currently reading, and a compact list of
your top-level topic folders.

**Goals** reads `Goals.md`: a `## ` heading per goal, an optional `target::`
date, and its milestones as ordinary task lines underneath, due-dated with
the same `📅` field every task in the vault uses. A milestone is a task, so
ticking one is the ordinary task rewrite; "Add a goal" appends a heading and
"Add a milestone" appends a task line under one.

**Sessions** reads `Sessions.md`: one line per sitting, `- YYYY-MM-DD
<duration> [[Topic]] a note`, filed under a `## YYYY-MM` heading. Durations
read as `1h30m`, `90m` or `1h`. The page logs a new one, and shows hours per
topic this month and a bar-per-week chart of the last eight weeks.

**Flashcards** is the review session, ported from before: cards are regions
of your notes written in Obsidian Spaced Repetition's syntax, graded with the
keyboard or a tap, and the schedule is written back in the plugin's own
comment, so a card reviewed here is due correctly in Obsidian too.

**Reading list** shows resources — courses, books, articles, videos — grouped
by status, inferred from the note when it says nothing itself. Moving one
between groups writes a single `status:` line into its frontmatter.

## Workspaces

A workspace is one markdown file under `_hub/workspaces/`. It is the whole
definition — its name, colour, tag, folders and whether it has meetings — so
editing it here or in Obsidian is the same edit. The "edit definition" link on a
workspace's page goes straight to that file for exactly this reason; there is
deliberately no settings form that would rewrite it behind your back. Older
workspace files may still carry a `tabs:` list from before this shape; it is
read and ignored rather than rejected, because every workspace now gets the
same sections regardless of what its file used to say.

Folders are comma separated and vault-relative. Notes and tasks inside them
belong to the workspace, and so does anything tagged `#ws/<slug>` wherever it
lives in the vault, which is what gives a task its workspace's dot on Today
and counts a time block as that workspace's time. Belonging is not the same
as being on the board: the board is `Board.md` and nothing else, so a tagged
task elsewhere stays in its note, untouched, and is not a card. The first
folder is the workspace's home: it is where `Board.md`, `Overview.md`,
`Inbox.md`, `Log.md`, `Glossary.md`, a `CRM/` folder and a `Pages/` folder of
custom pages all live.

A line `meetings: true` gives the workspace a meeting notebook (see
Meetings). Without it the workspace has none, which is the default, because
most workspaces never hold a meeting. **Start a meeting**, on every
workspace's Overview and glossary, adds that line for you the first time and
then opens the meeting notes, where you name the meeting and start it.

Last of all, an `aliases:` list in the workspace file claims a task that names
the workspace in its own words: with `aliases: [eye2gene, e2g]`, the daily
block "10:30 - 18:00 Work on eye2gene" counts as eye2gene's time although no
tag says so. The match is whole-word and ignores case, and it is tried only
after the tag, the folder and a `workspace:` field have all come up empty, so
a note sitting in one workspace's folder is never reassigned by a word in its
text — in practice only daily notes and the Inbox are ever claimed this way.
The workspace control in a card's drawer writes the tag instead, when you want
to say it outright.

A workspace always has an Overview: its board, its master note, an inbox
preview, the latest log entry, recent notes, and, for a workspace with
meetings, a link into its meeting notebook. CRM always shows, because a list
of contacts starts empty and filling it is the point. Every other tab —
Inbox, Log, Notes, and one per file in `Pages/` — hides itself until it has
something to show, so a brand new workspace opens quiet rather than full of
empty panes; visiting one directly still works; adding its first capture or
log line is what
brings the tab back.

**The board** is `Board.md`, written in the Obsidian Kanban plugin's own
format, so the same file opens as a board in Obsidian once the plugin is
installed and reads as a plain checklist until then. Each `##` heading is a
column; each `- [ ]` item under it is a card, with an optional due date
`@{2026-10-03}`, a priority `` `Q1` `` to `` `Q4` `` (the daily note's
convention), labels `#print`, and notes as the indented lines beneath it. A
workspace with no `Board.md` shows To do, Doing and Done, empty, and the
first change writes the file.

Drag a card within or between columns — anywhere on the card with a mouse,
by its ⠿ grip with a finger, since anywhere else a finger is scrolling. Its
⋯ menu does the same from the keyboard: Move up, Move down, and Move to…
any column. Each column's **Add card** takes one line and reads the details
out of it: "Call landlord fri Q1 #legal" is a card called "Call landlord",
due next Friday, priority Q1, labelled legal. The due words are today,
tomorrow, a weekday (the next one, never today), or a date written
`2026-10-03`. Clicking a card opens it to edit its title, due date, priority,
labels and notes, each saved as you leave the field. A due date turns red
once it has passed. Columns are added at the end, and renamed, moved or
deleted from their own ⋯ menu; only an empty column can be deleted.

This is the one file in the vault where prosoche moves lines. A drag cuts
the card's own lines — the item and its notes — and splices them in where it
was dropped, byte for byte; every other edit rewrites only the part of the
line it changes, or the card's notes. Nothing else in the file is touched,
including anything the plugin wrote that the board does not show, such as
its settings footer or an archive. Ticking a card writes `[x]` and leaves it
where it is, and dropping a card on the last column does not tick it — with
one exception kept from the plugin: a column with a `**Complete**` line
under its heading ticks cards moved into it and unticks cards moved out.
Every change carries the version of the file it was made against, so an edit
made in Obsidian or on another device in the meantime is refused rather than
overwritten, and the board reloads to show what is there now.

**The master note** is `Overview.md`, shown under the board as rendered
markdown. Edit opens the file exactly as it is, frontmatter included, and
Save writes it back whole; if the file has changed since you opened it,
nothing is written and it says so, so copy what you typed and Cancel to see
the newer version. With no `Overview.md` yet there is a "Write an overview"
button instead, and the first save creates the file.

**Inbox** is a capture box over `Inbox.md`: a bullet already written as a task
is ticked in place through the ordinary task rewrite; "make it a task" adds
any line's words as a card at the bottom of the board's first column, read
the way quick-add reads them and without the capture time, and ticks the
inbox line to show it has been filed. Nothing is ever deleted, only marked
done. An old `Tasks.md` is an ordinary note now, not the board.

**Log** is `Log.md`, a `## YYYY-MM-DD` heading per session. Sessions are shown
newest first; the file itself only ever grows downward, because "add an
update" appends under today's heading and never touches an earlier one.

**CRM** is the workspace's suppliers, stakeholders and leads, one note each
in `<home>/CRM/<Name>.md`. The file name is the contact's name, so
`[[Mang Tomas Foods]]` in any note links straight to it from Obsidian:

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

`kind` is supplier, stakeholder or lead in the form; any other word typed by
hand is still shown, and offered as a filter. The list is sorted by the
newest history entry, so whoever you spoke to last is on top, and can be
narrowed by kind and searched by name, company or role. "New contact" writes
the file with every field present, empty ones as a bare `key:`, and refuses a
name another contact already has (ignoring case, because Obsidian's links do)
or one that cannot be a file name or a link — a slash, a colon, `#`, `^`,
brackets, a leading or trailing dot.

A contact's page shows the details, the notes rendered, and the history
newest first. Saving the details rewrites only the fields you changed, each
through its own frontmatter lines; a value YAML would misread, such as
`+447700900123` or a bare date, is written in quotes. "Add entry" inserts one
line under `## History`, creating the heading if the note has none, ahead of
the first entry no newer than it, so a back-dated entry lands in date order.
Both carry the hash the page loaded, and a note changed in Obsidian meanwhile
is refused and reloaded rather than overwritten. Nothing here reads or writes
under `Private/`, and person notes elsewhere in the vault are left alone.

**Notes** lists the workspace's own notes, most recently changed first,
read-only, from the folders named in the workspace file.

**Custom pages** are the workspace's own HTML, one file per tab from its
`Pages/` folder. Each is served through its own endpoint with a strict
`sandbox` content-security-policy and embedded in an iframe with
`sandbox="allow-scripts"` and nothing more — never `allow-same-origin` — so a
page's own script can run but can never reach this origin's cookies, storage
or anything outside its frame.

## Date

Everything here lives under `Private/`, a folder that is never committed,
never indexed, never searched and never shown anywhere else: not on Today,
not in Notes, not in the palette. It is backed up only by the whole-box
backup the Proxmox host already takes, because syncing it anywhere else would
be exactly the leak this module exists to prevent.

Log is a day stepper and four counters — likes sent, matches (from your own
likes, whenever they arrived — liking back an incoming like is not counted as
one, or the match rate would read higher than it really is), how many of
those fit your type, and likes received — plus optional notes. The button
reads "Save as a zero day" when every counter is still zero. Stepping to a day
that already has a line loads it back; saving never goes past today.

Stats shows totals and rates over the last 7 days, the last 30, and all time,
a twelve-week trend and the best day of the week for matches, each rate
defined in the small print beneath it. Insights asks Claude for a short read
on patterns, on demand: it sends only the ledger and every person's dates
log, nothing else in the vault, and it only ever answers on screen — it has
no write of its own.

People are profiles — app, age, place, job, a stage from matched through
ended — with free notes and a dates log, one line per date. Changing a
person's stage, or adding a date, touches only that one line or appends one
new one; nothing already written is rewritten.

## Sync

The index — notes, tasks, links, tags — is rebuildable and never
authoritative. Deleting it and letting prosoche rebuild it from the vault is
always safe, because the vault is the only thing that actually holds state.

Automatic commits only ever stage files this app wrote; anything changed by
hand in an editor waits on this page for a person to choose, rather than
being swept up automatically.

The app's own state files, the `_hub/.state/` stamps among them, are never
committed: they exist to survive a restart, not to be shared. If a
copy of the vault on another device did commit them, the next pull here
replaces the local untracked copy with the incoming one rather than refusing,
then takes the files out of tracking, adds them to the vault's `.gitignore`
and pushes that one commit. The files stay on disk on every device.

Discarding a change throws it away on this server and puts the file back to
the last commit. A copy is saved first, so it is recoverable even though git
itself cannot undo the discard.

A conflict pauses pushing until it is resolved by hand. When one is showing,
the rebase behind it has already been rolled back, so the working copy on
this server is intact — nothing was left half-merged. Compare the two
versions, copy across whatever is needed, and then either continue the
rebase or reset to the remote, with `git rebase origin/<branch>` or
`git reset --hard origin/<branch>`.

## Settings

There is no mode that writes without you. prosoche never passes
`--dangerously-skip-permissions` to the CLI, and the CLI is never given the
vault itself as a working directory — both are enforced in code, not by a
setting someone could toggle off. The limits section holds the daily budget,
concurrency, and blast-radius caps that apply no matter what a feature itself
asks for, which is also why its heading is just "Limits" rather than a
sentence explaining that. The ten guardrails listed below are the same story:
they are code paths, not instructions in a prompt, so they hold regardless of
whatever the model itself says about what it is about to do.

