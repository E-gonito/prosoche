# How it works

The screens keep to one short hint per card, because a paragraph competing
with your actual notes for attention is the wrong trade. The fuller
explanation for anything trimmed from the UI lives here instead — nothing
written about prosoche is lost, only moved. A unit test reads this page and
`src/routes`, so a screen named here and missing there fails `npm test`.

Every tab is a module listed once in `src/lib/modules/index.ts`. The rail on a
desktop, the bottom bar and More sheet on a phone, and the command palette's
Go commands are all drawn from that list, so a new module appears in all of
them at once. Workspaces are listed under Workspaces in the rail and in the
More sheet.

## Today

The timeline is direct manipulation, not a form. Drag a block to move it, its
bottom edge to resize it, or focus one and use the arrow keys. Drag the ⠿ grip
beside an unscheduled task to give it a time, and drag a block out onto the
Unscheduled list, press its ✕, or press Backspace on it, to take the time off
again. Everything snaps to ten minutes, and only the time on that line
changes — the note keeps its own order regardless of where the UI displays a
task.

Under the Timeline heading is a chip for every project with a block today,
saying what it planned and what of that is done — "7h 20m planned", "30m
done", "1h 20m done of 7h 30m". A block counts towards a project when it
carries the project's tag, sits in one of its folders, or simply names it, so
a line reading "10:40 - 18:00 Client project" is counted without being tagged.
Ticked blocks are what "done" means here, minus anything a timer already
measured, and a short block inside a longer one of the same project counts
once. Blocks no project claims are left out rather than gathered into a row
that would only say you have not tagged them.

Capture appends to `Inbox/Capture.md` under today's date. A line written as a
task stays a task, so a captured to-do is immediately schedulable rather than
needing to be retyped later.

The unscheduled list is exactly what it says: everything in it has no time
yet. Once a task gets a time, from the grip or the timeline, it moves to the
timeline and leaves this list.

Open work from the rest of the vault gets its own list, grouped by workspace
and ordered the way a board column is: most urgent quadrant first, then the
soonest due date, then where the line lives. Each workspace contributes exactly
the open cards its board shows, so a line in a project's deck note appears here
with nothing else on it, while a line elsewhere in that project's notes still
needs a quadrant, a due date, an id or the workspace's tag. Work no workspace
claims is listed last under "Elsewhere", and has to carry a `Q1` through `Q4`,
because a quadrant is the only mark of intent such a line has. Daily notes are
excluded either way: each one is a copy of your template, so they would repeat
the same unfinished checklist every day. What is left out after that is
checklist notation inside reference notes, such as a syllabus or a manual test
plan, rather than work to schedule.

Each of those rows shows its due date, in red once it has gone by, and clicking
its text opens the same card drawer the day's own tasks use. The `+` button
puts the card on today with no time on it, so it lands in the unscheduled list
ready to be dragged onto the timeline — which is how you plan from a phone,
where there is no drag onto a grid.

Dragging one of those workspace tasks onto the timeline does something
different from dragging an unscheduled task: it adds a block to the day's own
note, linking back to the card, instead of writing a time onto the card's line
in its project note. A time with no date says nothing about which day it
belongs to, and this page only ever reads the day's note, so the card would
otherwise have vanished on the drop. The card itself is left exactly as it
was: the block is time spent on it, not a second copy of it.

A note that still has git conflict markers in it says so, here and on the note
itself, with a link to the sync page. Resolving a merge is yours to do, in
Obsidian or there; nothing in the app rewrites those lines for you.

The briefing strip only shows once the note actually has briefing markers in
it. Before that, it says plainly that this note has no briefing markers yet;
adding them changes your note, so it waits for you on the review page rather
than being applied on the spot.

The backlog — tasks written inside a fenced code block, such as the syllabus
example in the README — is shown read-only, because Obsidian treats those
lines as text, not tasks, and prosoche follows Obsidian's lead rather than
inventing its own.

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

Study widgets read flashcards, resources, topics and habits straight out of
your notes; nothing here is a separate database with its own opinions about
what you have learned.

## Workspaces

A workspace is one markdown file under `_hub/workspaces/`. It is the whole
definition — its name, colour, tag, folders and deal stages — so editing it
here or in Obsidian is the same edit. The "edit definition" link on a
workspace's page goes straight to that file for exactly this reason; there is
deliberately no settings form that would rewrite it behind your back. Older
workspace files may still carry a `tabs:` list from before this shape; it is
read and ignored rather than rejected, because every workspace now gets the
same sections regardless of what its file used to say.

Folders are comma separated and vault-relative. Notes and tasks inside them
belong to the workspace, and so does anything tagged `#ws/<slug>` wherever it
lives in the vault, which is what lets a task belong to a workspace without
living inside one of its folders. The first folder is the workspace's home:
it is where `Tasks.md`, `Inbox.md`, `Log.md`, `Deals.md` and a `Pages/` folder
of custom pages all live.

Last of all, an `aliases:` list in the workspace file claims a task that names
the workspace in its own words: with `aliases: [eye2gene, e2g]`, the daily
block "10:30 - 18:00 Work on eye2gene" counts as eye2gene's time although no
tag says so. The match is whole-word and ignores case, and it is tried only
after the tag, the folder and a `workspace:` field have all come up empty, so
a note sitting in one workspace's folder is never reassigned by a word in its
text — in practice only daily notes and the Inbox are ever claimed this way.
The workspace control in a card's drawer writes the tag instead, when you want
to say it outright.

A workspace always has an Overview: next actions, an inbox preview, the
latest log entry, anything blocked, recent notes, and a link into its meeting
notebook. Every other tab — Tasks, Inbox, Log, People, Notes, and one per file
in `Pages/` — hides itself until it has something to show, so a brand new
workspace opens quiet rather than full of empty panes; visiting one directly
still works; adding its first card, capture, log line, person or deal is what
brings the tab back.

**Tasks** is the board: a card is a checkbox line carrying a quadrant, a due
date, an id or the workspace's tag, or one that lives in the workspace's deck
note. The deck is the board written down, so every checkbox in it is a card
whether or not it carries anything else; a line anywhere else in the
workspace's notes carrying none of those marks is not shown, because it reads
as checklist notation rather than work. The board says how many it left out
and which notes they came from, and will show them one note at a time on
request. Give a line a quadrant and it becomes a card, by the same convention
the rest of your vault uses. Nothing is promoted for you. The same tab also
offers a flat list, filterable by status, for a quick scan or a phone.

**Inbox** is a capture box over `Inbox.md`: a bullet already written as a task
is ticked in place through the ordinary task rewrite; "make it a task" copies
any line's words into `Tasks.md` and ticks the inbox line to show it has been
filed. Nothing is ever deleted, only marked done.

**Log** is `Log.md`, a `## YYYY-MM-DD` heading per session. Sessions are shown
newest first; the file itself only ever grows downward, because "add an
update" appends under today's heading and never touches an earlier one.

**People** is the workspace's CRM: everyone its notes mention, the same way
`people.ts` finds anyone elsewhere, plus a deal pipeline read from
`Deals.md`. A deal line uses Dataview-style inline fields —

    - Moorfields pilot [[Jane Doe]] stage:: proposal value:: 12000 next:: 2026-10-03

— so it stays readable in Obsidian; a field this app does not know about is
kept exactly as written. The pipeline's stages default to lead, proposal,
negotiation, won and lost, or to whatever a workspace's own `stages:` list
names. Moving a deal writes only its `stage::` value, through the same
per-line conflict guard a task edit gets.

**Notes** lists the workspace's own notes, most recently changed first,
read-only, from the folders named in the workspace file.

**Custom pages** are the workspace's own HTML, one file per tab from its
`Pages/` folder. Each is served through its own endpoint with a strict
`sandbox` content-security-policy and embedded in an iframe with
`sandbox="allow-scripts"` and nothing more — never `allow-same-origin` — so a
page's own script can run but can never reach this origin's cookies, storage
or anything outside its frame.

## Sync

The index — notes, tasks, links, tags — is rebuildable and never
authoritative. Deleting it and letting prosoche rebuild it from the vault is
always safe, because the vault is the only thing that actually holds state.

Automatic commits only ever stage files this app wrote; anything changed by
hand in an editor waits on this page for a person to choose, rather than
being swept up automatically.

The app's own state files, the running timer and the `_hub/.state/` stamps,
are never committed: they exist to survive a restart, not to be shared. If a
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

