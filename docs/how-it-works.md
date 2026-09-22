# How it works

The screens keep to one short hint per card, because a paragraph competing
with your actual notes for attention is the wrong trade. The fuller
explanation for anything trimmed from the UI lives here instead — nothing
written about prosoche is lost, only moved. A unit test reads this page and
`src/routes`, so a screen named here and missing there fails `npm test`.

The sidebar and the command palette are two views onto the same short list of
destinations. A "T3 Code" entry joins both, but only once `HUB_T3_URL` names
a running T3 Code server; unset, neither shows it, rather than linking
somewhere that will not answer. It opens in a new tab rather than this one,
since its paired session belongs to that origin.

## Today

The timeline is direct manipulation, not a form. Drag a block to move it, its
bottom edge to resize it, or focus one and use the arrow keys. Drag the ⠿ grip
beside an unscheduled task to give it a time, and drag a block out onto the
Unscheduled list, press its ✕, or press Backspace on it, to take the time off
again. Everything snaps to ten minutes, and only the time on that line
changes — the note keeps its own order regardless of where the UI displays a
task.

Capture appends to `Inbox/Capture.md` under today's date. A line written as a
task stays a task, so a captured to-do is immediately schedulable rather than
needing to be retyped later.

The unscheduled list is exactly what it says: everything in it has no time
yet. Once a task gets a time, from the grip or the timeline, it moves to the
timeline and leaves this list.

The day's quadrant-tagged tasks — the ones carrying `Q1` through `Q4` — get
their own list, and its empty state is deliberately unapologetic: nothing here
yet, and that is correct rather than broken. The list only shows tasks
carrying a quadrant, because that is how you mark a line you actually intend
to do. Right now every task like that lives in a daily note, and those are
excluded: each one is a copy of your template, so they would repeat the same
unfinished checklist every day. Other checkbox lines were left out too. They
are checklist notation inside reference notes, such as the syllabus and the
manual test plan, rather than work to schedule. Add a `Q1` to one and it will
appear here.

The briefing strip only shows once the note actually has briefing markers in
it. Before that, it says plainly that this note has no briefing markers yet;
adding them changes your note, so it waits for you on the review page rather
than being applied on the spot.

The backlog — tasks written inside a fenced code block, such as the syllabus
example in the README — is shown read-only, because Obsidian treats those
lines as text, not tasks, and prosoche follows Obsidian's lead rather than
inventing its own.

## Notes

Cards go into a note in the Spaced Repetition plugin's own syntax, so Obsidian
sees them too; nothing is written until you accept it from a proposal.

The editor's toolbar buttons are terser than what they do: "Make card" turns
the current selection into a `Question::Answer` line, but that only reaches
the Spaced Repetition plugin once the note itself carries a `#flashcards` tag
— worth knowing the first time the card does not show up where you expected.

A conflict banner appears when a note changed on another device while you
were editing it. Nothing has been overwritten in that moment: your version and
theirs both still exist, and the banner is there so you can choose which one
to keep, or copy out anything you need from either side, before committing to
one.

## Study

Study widgets read flashcards, resources, topics and habits straight out of
your notes; nothing here is a separate database with its own opinions about
what you have learned.

## Workspaces and boards

A workspace is one markdown file under `_hub/workspaces/`. It is the whole
definition — which folders and tag belong to it, and which widgets each of
its tabs shows — so editing it here or in Obsidian is the same edit. The "Edit
definition" link on a workspace's page goes straight to that file for exactly
this reason; there is deliberately no settings form that would rewrite it
behind your back.

Folders are comma separated and vault-relative. Notes and tasks inside them
belong to the workspace, and so does anything tagged `#ws/<slug>` wherever it
lives in the vault, which is what lets a task belong to a workspace without
living inside one of its folders. Leaving the field empty is fine — folders
can be added to the file later.

A tab with no widgets it recognises says so instead of rendering a blank
space: check the workspace file's `widgets:` list against the catalogue for a
typo, since that is the only way to reach this state.

A board shows the workspace's cards, in the columns the workspace file names.
A card is a checkbox line carrying a quadrant, a due date, an id or the
workspace's tag; a checkbox line carrying none of those in this workspace's
notes is not shown: no quadrant, due date, id or workspace tag, so it reads as
checklist notation rather than work. The board says how many it left out and
will show them on request. Give a line a quadrant and it becomes a card, by
the same convention the rest of your vault uses. Nothing is promoted for you.

Cards are written to the workspace's deck note, appended one line at a time.
Anything written in the workspace's notes shows here too.

## Sync

The index — notes, tasks, links, tags — is rebuildable and never
authoritative. Deleting it and letting prosoche rebuild it from the vault is
always safe, because the vault is the only thing that actually holds state.

Automatic commits only ever stage files this app wrote; anything changed by
hand in an editor waits on this page for a person to choose, rather than
being swept up automatically.

Discarding a change throws it away on this server and puts the file back to
the last commit. A copy is saved first, so it is recoverable even though git
itself cannot undo the discard.

A conflict pauses pushing until it is resolved by hand. When one is showing,
the rebase behind it has already been rolled back, so the working copy on
this server is intact — nothing was left half-merged. Compare the two
versions, copy across whatever is needed, and then either continue the
rebase or reset to the remote, with `git rebase origin/<branch>` or
`git reset --hard origin/<branch>`.

## Review

Review is the queue of changes the app has drafted and not made. Nothing here
has touched a note: the weekly review and the morning briefing both run while
nobody is watching, so instead of writing on their own they stop and wait for
a person to look. With the AI layer off, nothing new arrives, but anything
already waiting can still be accepted or dismissed — turning the layer off
does not strand a half-reviewed queue. When the queue is empty, that is
because the briefing writes itself into today's note between its own
markers on its own schedule, and the weekly review appears here on a Sunday
evening; there is no button that fills this list on demand.

## Ask

Answers are read-only. Nothing on this page can change a note, whatever the
answer itself claims to have done — that guarantee lives in code, not in the
answer's wording. Past conversations are kept as markdown in the vault's own
history note, so they sync with everything else and no AI-backed feature can
edit them after the fact.

## AI settings

There is no mode that writes without you. prosoche never passes
`--dangerously-skip-permissions` to the CLI, and the CLI is never given the
vault itself as a working directory — both are enforced in code, not by a
setting someone could toggle off. The limits section holds the daily budget,
concurrency, and blast-radius caps that apply no matter what a feature itself
asks for, which is also why its heading is just "Limits" rather than a
sentence explaining that. The ten guardrails listed below are the same story:
they are code paths, not instructions in a prompt, so they hold regardless of
whatever the model itself says about what it is about to do.

## Widgets

**Inbox** lists what has not been filed yet, from the quick-capture note and
from stray notes dropped into the inbox folder. Nothing waiting there is a
finished state, not a lack of data.

**Pinned** lists anything tagged `#pin`; add that tag to a task to keep it
pinned here regardless of where else it lives in the vault.

**Blocked** lists cards waiting on another task, using a `⛔ id` /`🆔 id` pair
to connect the two. Nothing waiting on anything is the widget saying every
dependency it knows about is already clear.

**Notes** lists a workspace's own notes, most recently touched first, from
the folders named in the workspace file. A workspace with no folders yet has
nothing to list until one is added to its `folders:` line.

**People** lists the people a workspace, or the vault, has open threads with.
A person is a note under the people folder (`People/` by default); mentioning
someone with a wiki-link, or logging a contact from their own page, is what
creates that note — nobody has to create it up front. The person page
mirrors this: visiting someone with no note yet still shows the same
layout, minus the note itself, and logging a contact there is what brings the
note into existence.

**Time** compares this week's planned time against what was actually logged,
scaled to the busiest day rather than to a fixed number of hours. Nothing
logged is exactly that — a timer was never started and stopped against a
task this week, and it prompts starting one rather than showing an empty
chart.

**Insights** is Ask, scoped to whatever workspace or note it sits on, with
the same guarantee: it is read-only, and switching the AI layer off in
settings turns this widget off along with every other AI surface.

**Timesheet** renders today's timesheet section exactly as the note has it,
read-only, because the note is a document shared at work and every route out
of the card leads to Obsidian or to the read-only note view rather than to an
editor. Nothing written yet for today still names the last entry that does
exist, if there is one; no timesheet note at all names the folder prosoche
looked in, since it only ever reads notes named `TIMESHEET…` and never writes
one itself.

**GitHub** and **Linear** share one component for their rows, because the
server modules behind them return the same shape. Nothing open and assigned
to you is a real answer, not an error. Not connected is the state that ships
until a token exists: it names the environment variables to set and what each
is for, and reloading after setting them is what turns the card on — no
token is ever stored in the vault or the repository, and without one
prosoche simply never calls out to that provider.
