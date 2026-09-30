# How it works

The screens keep to one short hint per card, because a paragraph competing
with your actual notes for attention is the wrong trade. The fuller
explanation for anything trimmed from the UI lives here instead — nothing
written about prosoche is lost, only moved. A unit test reads this page and
`src/routes`, so a screen named here and missing there fails `npm test`.

Every tab is a module listed once in `src/lib/modules/index.ts`. The rail on a
desktop, the tab bar and More sheet on a phone, and the command palette's
Go commands are all drawn from that list, so a new module appears in all of
them at once. A module can nest sub-items under itself in the rail: the
workspaces are listed under Workspaces, and every glossary under Glossary.
The workspaces are also listed in the More sheet.

## Today

The dashboard for one day. The title names the day
you are looking at — "Tuesday 29 September", "3 days ago" beneath it — with
arrows either side and a jump back to today when you have wandered off it. A
one-line summary counts what the day did and is still owed: done against the
total, time planned, calendar events, and anything overdue.

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
blocks rather than teal ones, read-only, and linking nowhere. On a phone, a segmented control switches between the timeline and
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

## Glossary

Glossary keeps glossaries: each term, what it means, and why it matters.
A glossary belongs to no workspace. Each is one file in `Glossaries/` at the
vault root, and the file name is its name: `Glossaries/Computer Science.md`
is the glossary called Computer Science, at `/glossary/computer-science`. A
workspace can point at one (see Workspaces), and several workspaces can
point at the same one.

The Glossary page lists every glossary with how many terms it holds, how
many are still to look up. **Start a
glossary** under it takes a name and writes `Glossaries/<name>.md` holding
only a `# Glossary` title. A name is refused when another glossary has it
(ignoring case, as Obsidian's links do), when it would give the same address
as another, when it has no letter or digit, or when it cannot be a file name
or a link: a slash, a colon, `#`, `^`, brackets, a leading or trailing dot.
In the rail each glossary is a sub-item under Glossary.

A glossary's file holds one `##` heading per term, with `- status::`
(`to-look-up` or `looked-up`), `- category::` and `- source::` lines, then
the definition, then a line starting `→` saying why the term matters. Text
above the first heading is yours and is never touched.

A glossary's page has a filter box and a row of tabs: **All**, one per
category with its count, and **To look up** while any are still waiting.
Each entry shows its category, the definition, where it came from and the `→`
line. There is no "my guess": a `- guess::` line written by an older version
is left in the file and not shown. Type a term in (with a category if you
like) to append an entry to look up; a term the glossary already has is
refused rather than written twice. **Edit** on an entry opens its name,
category, definition and `→` line in place; saving rewrites only that entry's
lines, keeps its other fields (source, drafted), and marks a term still to
look up as looked up once it has a definition. A rename onto a term the
glossary already has is refused. **Delete** on an entry asks first, then
removes the entry's heading and every line under it, and nothing else.

**Rename**, beside the title, renames the file: the glossary's bytes are
written unchanged under the new name, the old file is removed, and every
workspace whose `glossary:` named it is changed to the new name, one line
each. A name another glossary has is refused, so nothing is overwritten.
**Delete** asks "Delete this glossary?" in place, then removes the one file;
the deletion is committed, so git history still has it. A workspace still
pointing at a deleted glossary keeps its `glossary:` line.

**Look up with Claude** drafts the definition and the `→` line, and marks the
entry looked up with `- drafted:: Claude`; **Look up all** does every waiting
term in one proposal, twenty at most. The context is the definition file of
each workspace pointing at the glossary. A glossary no workspace points at is
looked up from its terms alone.

A look-up is a proposal like every Claude button's: it is shown as a diff
first and writes only the glossary's own file, and only when you accept.

Look-ups use the Glossary look-up's model settings. A `sources:` or
`scanned:` line in a glossary's frontmatter, left by the scan for new terms
this version no longer has, is ignored and left in the file.

**Flashcards.** A glossary can be linked to a study subject, and then every
term with a definition is a flashcard there, kept in step with the
glossary; no model is involved. The **Flashcards** line under the title has
a picker of the study subjects and Not linked, and says how the cards
stand: "226 cards in CS study · up to date", linking to that subject's
Flashcards tab, or how many card files are still to update. Picking a
subject writes `study: <subject slug>` into the glossary's frontmatter, as a
span edit of that one line; Not linked empties it, which stops the syncing
and leaves the cards where they are. A `study:` naming no study subject
reads as unlinked, and the page says so.

Each term is one card, reviewed both ways: the term, a `??` line, then the
definition and the `→` line (the definition alone when there is none). A
term still to look up has no card until it has a definition. The cards go
in one file per category,
`<subject home>/Flashcards/Glossary/<Glossary name>/<Category>.md`, and a
term with no category in `Uncategorised.md`; the glossary's name is in the
path, so two glossaries linked to one subject never share a file. A new file
starts

    ---
    goal:
    glossary: Computer Science
    category: Cloud
    ---

    #flashcards

    Made from [[Computer Science]] (Cloud). Edit the terms there; this file is
    kept in step with the glossary.

    VPC
    ??
    An isolated virtual network within a cloud provider…
    → Where eye2gene's endpoints live.
    <!--fsrs:2026-10-02,3.21,5.8,4,0,review,2026-09-29!new-->

These files are prosoche's, as a workspace's `Board.md` is: their cards
follow the glossary. A card is matched to its term by its front, ignoring
case and spacing. An edited definition or `→` line rewrites that card's
lines in place and keeps the review comment under them; a term moved to
another category moves its card, comment and all, to the end of that
category's file; a new term's card goes at the end of its file, which is
made when it is not there. Deleting a term leaves its card, for you to
delete; renaming one makes a new card and leaves the old. `goal:`, which the
Flashcards tab sets, any other frontmatter, every review comment and any
card you add by hand are always kept. Each card gets the Anki import's
escaping, and each file must read back through the card finder as exactly
the cards it should hold, or it is left as it is and the glossary page and
the server log say why. Nothing outside the glossary's own folder of cards is touched.

The cards are brought in step after every write the app makes to a linked
glossary (adding, editing or deleting a term, linking it), before the page reloads; on any change to a linked glossary
from outside, such as an edit in Obsidian or a git pull, a second after the
last change; and for every linked glossary when the hub starts. One
glossary is synced at a time, a file is written only when it differs, and
each write is pinned to the file as it was read, so a card file edited
meanwhile is left alone until the next change. A card moving between two
files is written into its new file before it is cut from the old one.
Renaming a glossary here moves its folder of cards to the new name, review
history and all; a rename made in Obsidian starts a new folder and leaves
the old one.

Glossaries used to be `Glossary.md` in a workspace's folder. At start the
hub moves any such file it finds, once: for each folder of each workspace, a
`Glossary.md` in it moves to `Glossaries/<folder's name>.md`, the name being
the last part of the folder's path rather than the workspace's name, so
`Computer Science/Glossary.md` becomes `Glossaries/Computer Science.md`
whatever its workspace is called. The bytes are copied unchanged and the old
file removed, so git history keeps it.  A file
already in `Glossaries/` by that name is never overwritten: the old one is
left where it is and the start-up log says so. Once no old file is left,
this does nothing.

## Notes

Notes are read-only here: Obsidian is the editor. The list page searches the
whole vault, shows what changed recently, and offers the folder tree. A note
shows its rendered text beside its properties, tags, the notes that link to
it and the notes it links to; Browse opens the folder tree as a side sheet.

The capture box appends one line to `Inbox/Capture.md` under a `## <day>`
heading. A line that is already a task is kept as written; anything else is
stamped with the time. That file is the only thing the Notes module writes.

The private folder, `Private/`, never appears here: not in search, the tree,
backlinks or recent notes. A link straight to a private note is a 404.

## Study

Study is divided into subjects — CS, Filipino, whatever comes next. A
subject is a workspace whose file says `template: study`, and there can be
any number; each is listed under Study in the rail. Nothing is shared
between two subjects but the code. A subject's own files live in its home
folder, the first folder its workspace names: `Goals.md`, `Reading List.md`,
`Sessions.md` and a `Flashcards/` folder. Its cards come from every folder
it names, so reference notes kept elsewhere can sit beside the home as
further folders, and from any note tagged with the workspace's tag.
Folders, at the foot of a subject's page, adds or removes those (see
Workspaces).

**The Study page** shows one card per subject — its goals with milestones
done out of total, this week's hours and the cards due — and the cards due
across every subject, with Review everything due, which reviews them all in
one session; Today's flashcards card leads there too. New subject takes a
name and, optionally, reference folders, and writes the workspace file with
`template: study`, homed at `Study/<name>`; a name another workspace
already has is refused, and so is "Review", which that page already is. The
old single-subject addresses, such as `/study/goals`, open that tab of the
only subject, or this page when there are several.

Every subject has six tabs, always shown, because a new subject should
invite filling in rather than hide: Overview, Notes, Goals, Reading list,
Sessions and Flashcards.

**Notes** is the subject's own folders from the vault, as a tree on the left
and the chosen note read in place on the right (on a phone, the tree above
the note). A filter box narrows the tree to the notes whose path matches.
Each note offers Open in Notes for the
vault-wide reader. It is read-only; editing stays in Obsidian. Only notes
inside the subject's folders open here, so what it shows is exactly what the
subject's `folders:` names.

**Goals are a subject's topics.** A goal is a `## ` heading in `Goals.md`,
with an optional `target::` date and its milestones as ordinary task lines
underneath, due-dated with the same `📅` field every task in the vault
uses. A milestone is a task, so ticking one is the ordinary task rewrite;
"Add a goal" appends a heading and "Add a milestone" appends a task line
under one. Reading items, sessions and card files each point at a goal,
which is how progress rolls up: every goal picker in Study offers the same
list, the headings of `Goals.md` in order. A goal is matched by its name
ignoring case and punctuation, and one naming a goal that is no longer in
`Goals.md` counts as belonging to none.

**Overview** shows each goal with its milestones done out of its total and
what is next, the hours logged on it this week, what is in the Reading
group for it and the cards due in its files, with a link that reviews just
those; then whatever points at no goal. Above them are the cards due in all,
this week's time against a `weekly_hours:` target from `Goals.md`'s
frontmatter, and the streak of consecutive days with a session logged.

A card can hold a fenced code block, blank lines and all, as it can in the
plugin.

**Import Anki decks**, linked from a subject's Flashcards tab
(`/study/<subject>/import`), turns the Anki exports under `Flashcards/` into
card files for that subject. Each `.txt` deck becomes one note at the same
path under the subject's own `Flashcards/` folder, so
`Flashcards/CS/Networking/HTTP.txt` becomes
`Study/Computer Science/Flashcards/CS/Networking/HTTP.md`. The note has `goal:` left empty for
you to set, `source:` naming the `.txt`, and a `#flashcards/<deck>` tag from
the Anki deck name (`CS::Networking` is `#flashcards/cs/networking`). Each
card is written `Q::A` when both sides are one line and a `::` would not be
ambiguous, and as the multiline `?` form otherwise. HTML becomes markdown:
line breaks (including the escaped `&lt;br&gt;` these exports use), bold,
italic, lists, links, images as image links, entities, and `<pre>` as a
fenced block. Two things the plugin's syntax cannot hold are changed: a blank
line outside code would end the card, so it is dropped, and a heading would
too, so it becomes a bold line. A lone `?` line and a `#word` that would
become a vault tag are escaped. Every card is read back through the same card
finder review uses before it is written; one that would not read back as the
same card is left out and listed as a problem. Review history starts fresh.

The page shows every deck first — its target, card count, a sample card and
any problems — and writes only when you press **Import**, then says what it
created and what it skipped. It never overwrites a file: a deck whose card
file is already there is skipped and says so, so running it again only fills
in what is missing. The `.txt` decks are never modified.

**Reading list** is `Reading List.md`, which prosoche owns as it owns a
workspace's `Board.md`: it is a board in the Obsidian Kanban plugin's
format, with columns To read, Reading, Paused and Done, so it opens as a
board in Obsidian. A subject with no file shows those four, empty, and the
first change writes it. Done is marked `**Complete**`, so an item moved
there is ticked. Each item is one card line:

    - [ ] [CS:APP](https://csapp.cs.cmu.edu) [[Goals#Computer Systems]] #book

The title is a link to where it is read (or plain words without one), the
goal a link to its heading in `Goals.md`, and the kind — book, course,
video, article, paper or other — the card's tag, with other written as no
tag. The page shows the columns as grouped lists. Add takes a title, a
link, a kind, a goal and the group; Edit opens an item in place with the
same fields; its status menu moves it to another group, its ⋯ menu moves
it up or down or deletes it, asking twice. Every change is the board's
own byte-exact edit — a move cuts the card's lines and splices them in
elsewhere, an edit rewrites only what changed, a delete removes only the
card — and carries the version of the file it was made against, so an edit
made in Obsidian meanwhile is refused and the list reloads.

**Sessions** is `Sessions.md`: one line per sitting, `- YYYY-MM-DD
<duration> [[Goals#<goal>]] a note`, filed under a `## YYYY-MM` heading.
Durations read as `1h30m`, `90m` or `1h`. The page logs a new one against a
goal picked from the list, and shows hours per goal this month and a
bar-per-week chart of the last eight weeks. A session from before goals,
`[[Topic]]`, still reads, and is shown as it is written rather than folded
into a goal.

**Flashcards** lists the subject's card files: notes in its folders
holding cards in Obsidian Spaced Repetition's syntax that carry a
`#flashcards` tag or already have a review comment. They are grouped by
the goal their frontmatter names, `goal: <goal>`, which puts every card in
the file under that goal; each file's picker sets it, rewriting that one
frontmatter line and nothing else. Review all, or Review beside a goal,
starts a session: `/study/<subject>/review`, or `?goal=<slug>` for one
goal. Cards are graded with the keyboard or a tap: Again, Hard, Good or
Easy, each button showing when the card would come back. Scheduling is
FSRS, the algorithm Anki uses, through its official TypeScript port
`ts-fsrs`, with Anki's default parameters, 90% desired retention and one
ten-minute learning step; a card due again today comes back at the end of
the session. The state is written back on the line after the card in a
comment of prosoche's own, one entry per card side:

    <!--fsrs:2026-10-02,3.21,5.8,4,0,review,2026-09-29-->

that is the due day, stability, difficulty, reviews, lapses, state and the
day last reviewed. The Obsidian Spaced Repetition plugin no longer
maintains these cards: a card reviewed here is one it cannot read, so review
them only in prosoche. An old `<!--SR:…-->` comment the plugin wrote is
still read, as a review card whose stability is its interval and whose
difficulty follows its ease, and is rewritten in the new form only when that
card is next graded; a note nobody reviews is never touched. Notes holding cards but no tag are listed
separately, since neither Obsidian nor Study reviews them until the tag is
added. A glossary linked to the subject keeps its cards under
`Flashcards/Glossary/<Glossary name>/`, one file per category, and they
show here like any card file, grouped by goal with the same picker (see
Glossary).

**New cards a day.** Cards never reviewed join a subject's reviews twenty a
day; the rest wait. A subject's workspace file can set another number with
`new_per_day:`, and 0 lets none in. Today's new cards are the first ones
never reviewed in the subject's folders, by file path and then position in
the file, less those already reviewed for the first time today, so the
choice is stable through the day and the next ones follow tomorrow. The
subject's review, a goal's review, each file's count, Review everything and
Today's flashcards card all use this rule, so they offer the same cards;
Review everything lets in each subject's own new cards. The Flashcards tab
and the subject's page say "20 new today · 206 waiting". A card's first
review is counted per subject and day in `_hub/.state/new-cards.json`,
which is never committed and holds only today; the review comments cannot
tell a first review from a later one, so the count is kept rather than
worked out.

## Workspaces

A workspace is one markdown file under `_hub/workspaces/`. It is the whole
definition — its name, colour, tag, folders, which glossary
it points at, and for a study subject how many new cards a day
join its reviews — so
editing it here or in Obsidian is the same edit. The "edit definition" link on a
workspace's page goes straight to that file for exactly this reason; there is
deliberately no settings form that would rewrite it behind your back.
The one exception is **Folders**, at the foot of a workspace's Overview and
of a study subject's page: it lists the home, which never moves, then each
reference folder, with × to stop reading one and a field (suggesting the
vault's folders, but taking any path) to add another. Each change rewrites
only the `folders:` lines of the file and every other byte stays as it was.
**Delete** on the Workspaces list removes that one file, after a confirm, and
nothing else: the workspace's folders, notes and board stay in the vault, as
does any glossary it pointed at, and the deletion is committed, so git history still has the file. Older
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
`Inbox.md`, `Log.md`, a `CRM/` folder and a `Pages/` folder of custom pages
all live. Glossaries are not kept here; they have their own folder (see
Glossary).

A line `glossary: <name>` points the workspace at the glossary of that name,
`Glossaries/<name>.md`, matched ignoring case; the glossary's look-ups read
the workspace's definition file for context. It is optional. Several
workspaces may name the same glossary, and renaming a glossary rewrites this
line in each of them. A `meetings:` line, from before Meetings was removed,
is ignored.

A study subject (`template: study`) may say `new_per_day: <number>`: how
many cards never reviewed join its reviews each day. It is 20 without the
line, and 0 lets none in; anything but a whole number reads as 20 (see
Study).

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
preview, the latest log entry, recent notes. CRM always shows, because a list
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
labels and notes, each saved as you leave the field; Delete card, asked
twice, removes the card and its notes. A due date turns red
once it has passed. Columns are added at the end, and renamed, moved or
deleted from their own ⋯ menu; only an empty column can be deleted.

This is the one file in the vault where prosoche moves lines. A drag cuts
the card's own lines — the item and its notes — and splices them in where it
was dropped, byte for byte, and a delete cuts them alone; every other edit rewrites only the part of the
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

Every model run is read-only, always, and that is not a setting. The CLI is
given an empty tool list and no directory, runs from the temp folder rather
than the vault, and sees only the notes the server puts in its prompt;
prosoche never passes `--dangerously-skip-permissions`. All three checks are
made on the actual arguments just before the process starts. So the table
per feature holds only model, effort, budget and timeout, and there is no
permission column. Anything that would change a note, the morning briefing
included, comes back as a proposal and is written only after you accept it.

The limits section holds the daily budget and the blast-radius caps that
apply no matter what a feature itself asks for. The nine guardrails listed
below are the same story: they are code paths, not instructions in a prompt,
so they hold regardless of whatever the model itself says about what it is
about to do. Their numbers skip G3, "sandbox for tool runs", which went with
the tool runs; the audit log keeps quoting the old numbers, so they were not
renumbered. Undo lists the snapshots taken before each accepted write; each
is kept seven days, and older ones are cleared the next time a proposal is
applied.

Save rewrites `_hub/ai.md` whole: its frontmatter and its explanatory text
come from the form, so a hand edit to the prose or a key the page does not
show (a `defaults:` block, a comment) is replaced. The exception is a
`features:` entry for a feature this version does not know, such as one since
removed: it is carried over byte for byte, after the known ones. A
`permission:` line from an older file is ignored on read and dropped from the
known features on save.
