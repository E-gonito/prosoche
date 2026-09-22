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

Last of all, an `aliases:` list in the workspace file claims a task that names
the workspace in its own words: with `aliases: [eye2gene, e2g]`, the daily
block "10:30 - 18:00 Work on eye2gene" counts as eye2gene's time although no
tag says so. The match is whole-word and ignores case, and it is tried only
after the tag, the folder and a `workspace:` field have all come up empty, so
a note sitting in one workspace's folder is never reassigned by a word in its
text — in practice only daily notes and the Inbox are ever claimed this way.
The workspace control in a card's drawer writes the tag instead, when you want
to say it outright.

A tab with no widgets it recognises says so instead of rendering a blank
space: check the workspace file's `widgets:` list against the catalogue for a
typo, since that is the only way to reach this state.

A board shows the workspace's cards, in the columns the workspace file names.
A card is a checkbox line carrying a quadrant, a due date, an id or the
workspace's tag, or one that lives in the workspace's deck note. The deck is
the board written down, so every checkbox in it is a card whether or not it
carries anything else; a line anywhere else in the workspace's notes carrying
none of those marks is not shown, because it reads as checklist notation
rather than work. The board says how many it left out and which notes they
came from, and will show them one note at a time on request. Give a line a
quadrant and it becomes a card, by the same convention the rest of your vault
uses. Nothing is promoted for you.

Cards are written to the workspace's deck note, appended one line at a time,
and the note is created the first time you add one. Anything written in the
workspace's notes shows here too. The count beside a workspace in the rail is
its open cards, the same ones Today lists under "From your workspaces".

A new project or business workspace starts on five tabs: an Overview of its
board and its time, then Notes, People, Blocked and Insights, each still
empty until its notes give it something to show. A tab's own number, beside
its title, is open cards for Overview, cards waiting on another for Blocked,
and people in scope for People; a tab with nothing to count shows no number
at all, and a tab with a genuine zero shows it muted rather than hidden.

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
answer's wording. A question scoped to a workspace also carries a short block
of figures: this week's planned, done and timed minutes day by day, the open
cards column by column, what is overdue and what is blocked, the week's daily
blocks, and the ten notes changed most recently. Those figures are computed
from the index and the daily notes at the moment the question is asked rather
than retrieved from any note, which is why an answer quotes them as "computed
from your notes" instead of linking to a file. Past conversations are kept as
markdown in the vault's own history note, so they sync with everything else
and no AI-backed feature can edit them after the fact.

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

**Time** compares this week's planned time against what actually happened,
scaled to the busiest day rather than to a fixed number of hours. Two things
say work happened. Ticking a timed block counts its planned length as done,
because the tick is the user's own statement that the block went as planned;
a timer counts what it measured. A ticked block a timer entry matched counts
once, as timed, since the timer line is the finer record of the same work.
Blocks nest, so a short block inside a long one counts once in the day but
once for each project the two belong to, which is why the per-project split
can add up to more than the week and says so when it does. Nothing ticked
and nothing timed is exactly that, and it names both ways of counting rather
than showing an empty chart.

**Insights** is Ask, scoped to whatever workspace or note it sits on, with
the same guarantee: it is read-only, and switching the AI layer off in
settings turns this widget off along with every other AI surface. On a
workspace it is handed the same computed figures the Ask page is, and the line
under the box says what they amount to — open cards, overdue, blocked, the
week's blocks and its hours — before anything is asked or spent.

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
