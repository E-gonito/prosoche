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
one-line summary counts what the day did and is still owed: done against
what the day owes, how many were skipped, time planned, calendar events, and
anything overdue. From 18:00 on today, and on any past day with a note, the
line ends with **Review the day** (see Review, below).

**Done, skipped, open.** A task line is in one of three states: open (`[ ]`,
or `[/]` and `[!]`), done (`[x]`), or skipped (`[-]`, Obsidian's cancelled
checkbox). Skipped means the day let it go: it is struck through wherever a
task is shown, with a dash in its box, and it counts as neither done nor
owed, so "4 of 7 done · 2 skipped" is a day of nine lines. Its box takes it
back to open.

**A daily note is made only when you press for it.** When the day's note is
not there, Today names the path it would create and offers **Create today's
note**. Pressing it copies `Journal/Journal Template.md` to that path byte
for byte; the template's `{{date}}` and `{{title}}`, if it has any, become
the day's `YYYY-MM-DD`, and any other placeholder is left as written. With no
template, the note gets only a `# Tasks` heading, and Today says so. A note
that is already there is never overwritten. Nothing else creates one: not a
timer, not the briefing, not a card or a capture planned onto the day. Two
devices each making the same new file is the one clash git cannot merge on
its own, so if Obsidian on another device may already have made the day,
let it sync first.

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

The box at the top of the Unscheduled list adds a task to the day. What you
type goes into the day's note under `# Tasks` as a `- [ ]` line: with a
time range, `10:00 - 10:30 Dentist`, it lands on the timeline; without one
it joins the unscheduled list, where its ⠿ grip can drag it onto the
timeline. A `#ws/kaya` tag stays on the line, which is what puts a daily
task in that workspace. On a day with no note the line goes to
`Inbox/Capture.md` instead and the message says so; nothing is created.

Every other capture box, the `c` and `k` keys and the phone's share sheet
send a line where its words say. One with a time range goes into today's
note and onto the timeline. One that names a workspace by its tag or one of
its aliases goes onto that workspace's board, at the bottom of the first
column, read the way the board's quick-add reads it; the tag itself is left
off the card. Anything else lands in `Inbox/Capture.md` under today's date,
a bare thought stamped with the time and a line written as a task kept as a
task. A line naming a workspace that has no board yet goes to the inbox
instead; nothing is lost and nothing is created. The unscheduled list is
exactly what it says: once a task gets a time, from the grip or the
timeline, it moves to the timeline and leaves this list.

**Inbox** is a card with its own capture box, for a thought that is not a
task for today: a line typed there goes where its words say (see above),
which for a bare thought is `Inbox/Capture.md`. Under the box are the newest
five unfiled lines, how many are waiting and a link to the triage page (see
Inbox). The card is always there; only the list and the count go when the
inbox is empty.

**This week** is seven small bars, Monday to Sunday of the week the day is
in: each day's owed tasks (done and open) in the pale bar, the done ones in
the teal inside it, read from each day's own note. A skipped task is in
neither, so skipping shortens the bar rather than filling it; the bar's
label names how many were skipped. A bar opens its day.

**Overdue** lists two kinds of thing whose due date has passed. First the
open cards on any workspace's board, each with its workspace's dot; tick one
and it is ticked in that board's `Board.md`. Then open tasks from anywhere
else in the vault with a Tasks-plugin due date, daily notes excluded, because
each of those is a copy of your template and would otherwise repeat the same
unfinished checklist; each of those rows has a button to plan it onto today.

**From your workspaces** shows every open board card of each workspace,
most urgent first — priority first, then the soonest due date — in a list
that scrolls past the first three and a half, plus how many lines of the
inbox carry its tag or an alias. A card's
title opens its workspace, where the board is; its checkbox ticks it in
`Board.md`. Its ⠿ grip drags it onto the day: dropped on the timeline, a
block such as `- [ ] 10:00 - 10:30 Book the venue [[Work/Board]] #ws/work`
is appended under `# Tasks` in the day's note; dropped on the unscheduled
list, the same block with no time. The card stays where it is on its board,
untouched; the block is the time spent on it.

Beyond that, any module may add a card of its own — Flashcards offers one
line for the cards to review across every deck, once something is. A private module never does: nothing of
Date's appears here, or anywhere outside its own screen.

A note that still has git conflict markers in it says so, with a link to the
sync page. Resolving a merge is yours to do, in Obsidian or there; nothing in
the app rewrites those lines for you.

### Review

The evening review, at `/today/review` for today and `/today/<day>/review`
for any other day. It is reached from Today's **Review the day**, the
palette's `r`, and on a phone its own tab beside Today; the rail keeps Today
lit, because it is Today's page. It lists every task in the day's note, the
timed ones first by start as the timeline has them and then the rest in note
order, each with a large tick, its time, its workspace's dot and a **Skip**.

A tick writes `[x]` and a skip writes `[-]`; pressing either again puts the
line back to `[ ]`. Each is one character on one line, sent with the line as
the page last saw it, so a line changed elsewhere since is refused and the
list reloads. With a row focused, space or Enter ticks, `s` skips, and the
arrow keys walk the list. Nothing is ticked without a press.

The top carries the same summary line as Today, and the bottom how many
lines wait in the inbox, linked to its triage page, so closing the day
includes emptying it.

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
line. Type a term in (with a category if you
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

**Scan notes for new terms** is how notes become cards: Claude reads the
notes in the folders you name for terms the glossary lacks, you tick and edit
what it found, and the terms you add join the glossary, and so its cards
once they have a definition. **Scan notes**, beside Add term, opens it; so
does `#scan` at the end of the glossary's address, which is where a study
subject's link goes (see Study). A glossary remembers where to scan in its
frontmatter: `sources:`, a list of vault folders, and `scanned:`, the day of
the last full scan. A glossary with no terms yet but with folders to read opens with the scan showing.

    ---
    sources:
      - Computer Science
    scanned: "2026-09-29"
    flashcards: true
    ---

The folders show as chips, each with × to remove it, and **Add** takes
another (the field suggests the vault's folders; the private folder, `_hub/`
and `Glossaries/` are never offered). Each change rewrites only the
`sources:` lines; a glossary with no frontmatter gains a small block at the
top, and its body is never touched. With no folder yet, there is nothing to
scan. When the glossary's flashcards are on, one line under the folders
says the terms you add become cards in its deck.

One button then scans. Before a first scan it reads "Scan all 118 notes";
after one, "Scan 12 notes changed since 29 Sep", counting the notes under
the folders whose modified day is that day or later (a note edited on the
day of a scan is read again rather than missed), with **Scan all 118 notes
instead** beside it. Empty notes are not counted. The notes are split into
batches of at most 60,000 characters (12,000 of any one note), and the page
runs the batches one after another by itself, showing "Batch 3 of 9 · 41 new
terms so far" and a **Stop** button. Stop drops the batch in flight; the
terms found so far stay. Scanning again while a list is not yet added asks
"Discard the 12 terms not yet added?" in place first.

A `Flashcards/` folder anywhere is never read and never offered as a
source: cards are made from glossaries, and reading them would feed a
glossary its own cards back.

Each batch is one read-only run through the same runner as every AI
feature: the kill switch and the budget are checked first, the CLI gets no
tools, and the run is logged. Claude reads the notes as quoted data, and
the glossary's own terms and categories, which it is told so it does not
propose them again, are quoted data too. It drafts entries for the technical
terms the notes define or use, each with a category, a definition, a `→`
line, the note it came from and a sentence quoted from it. An entry is kept
only if that sentence is in the note and the term is in that sentence (a
bracketed part, either side of a slash, or a plural will do); the rest wait,
collapsed, under **Left out**. Terms the glossary already has, or an earlier
batch found, are left out of the list, compared ignoring case and spacing.

Nothing is written until you add. Every candidate shows its term, category,
definition, `→` line, the quoted sentence and a link to its note, with a
tick box, ticked to start with, and fields to edit each part (the
glossary's categories are suggested). A term the scan missed can be typed
into the list under it. **Select all** and **None** tick or untick the terms
shown, and a row of category chips shows one category at a time. A ticked
term with no name, one the glossary has, one ticked twice, or a `→` line
with no definition is marked, and **Add N terms**, which stays at the
bottom of the screen, waits until it is fixed or unticked. **Discard** asks
in place too.

Add sends only the ticked terms, as edited, and the server checks them all
again: the glossary must be there; each term needs a name that reads back as
its heading, within length limits (120 characters for a term, 1,500 for a
definition); no term may be one the glossary has now or be sent twice; and
each note must be a markdown note under the glossary's `sources:` as the file
says now. Any failure refuses the lot and says which terms. Each term is then
appended after every byte already in the file: with a definition, as
`- status:: looked-up` with its category, `- source:: [[<note>]]`,
`- drafted:: Claude` when the definition is Claude's, then the definition
and `→` line; with the definition left empty, as `- status:: to-look-up`,
for **Look up with Claude** later. A term typed in has no source line. When
the scan read every batch, `scanned:` is set to today; after a Stop, or with
no scan at all, it is left alone, so the notes not read are still counted as
changed next time. The result must read back as the old entries unchanged
plus exactly the new ones, and it is written once, pinned to the file as it
was read, so a glossary edited meanwhile is refused and nothing is written.
The page then says "Added 23 terms" and the new entries appear in the list.
A full scan that found nothing offers **Mark these notes scanned**, which
sets only `scanned:`.

Look-ups use the Glossary look-up's model settings, and scans the Glossary
scan's, one run per batch.

**Flashcards.** A glossary's terms can be flashcards, kept in step with the
glossary; no model is involved. The **Flashcards** switch under the title
turns them on or off and says how they stand: "271 cards in its deck · up
to date", linking to the glossary's deck on the Flashcards page, or how many
card files are still to update. It writes `flashcards: true` or `false`
into the glossary's frontmatter, as a span edit of that one line; turning
it off stops the syncing and leaves the cards where they are. A glossary
from before, when cards lived in a study subject, still says `study:
<subject>` and no `flashcards:`; it reads as on, and the switch clears the
old line the first time it is used. A glossary may also say `new_per_day:`,
the most of the day's new cards its deck may take (see Flashcards).

Each term is one card, reviewed both ways: the term, a `??` line, then the
definition and the `→` line (the definition alone when there is none). A
term still to look up has no card until it has a definition. The cards go
in one file per category, `Flashcards/<Glossary name>/<Category> (cards).md`,
and a term with no category in `Uncategorised (cards).md`; the glossary's
name is in the path, so two glossaries never share a file, and ` (cards)`
keeps a card file from sharing its name with a note, since a bare
`[[Networking]]` could open either. `Flashcards/` also holds the `.txt`
decks another tool generates; only the `.md` files are prosoche's, and the
rest are never read or touched. A new file starts

    ---
    glossary: Computer Science
    category: Cloud
    ---

    #flashcards

    Made from [[Glossaries/Computer Science|Computer Science]] (Cloud). Edit the terms there; this file is
    kept in step with the glossary.

    VPC
    ??
    An isolated virtual network within a cloud provider…
    → Where eye2gene's endpoints live.
    <!--fsrs:2026-10-02,3.21,5.8,4,0,review,2026-09-29-->

These files are prosoche's, as a workspace's `Board.md` is: their cards
follow the glossary. A card is matched to its term by its front, ignoring
case and spacing. An edited definition or `→` line rewrites that card's
lines in place and keeps the review comment under them; a term moved to
another category moves its card, comment and all, to the end of that
category's file; a new term's card goes at the end of its file, which is
made when it is not there. Deleting a term leaves its card, for you to
delete; renaming one makes a new card and leaves the old. Any frontmatter,
every review comment and any card you add by hand are always kept. Each
card is escaped so it reads as itself (a blank line dropped, a heading made
bold, a lone `?` or a `#word` escaped), and each file must read back through
the card finder as exactly the cards it should hold, or it is left as it is
and the glossary page and the server log say why. Nothing outside the
glossary's own folder of cards is touched.

The cards are brought in step after every write the app makes to a glossary
whose cards are on (adding, editing or deleting a term, turning them on),
before the page reloads; on any change to one from outside, such as an edit
in Obsidian or a git pull, a second after the last change; and for every
such glossary when the hub starts. One glossary is synced at a time, a file
is written only when it differs, and each write is pinned to the file as it
was read, so a card file edited meanwhile is left alone until the next
change. A card moving between two files is written into its new file before
it is cut from the old one. Renaming a glossary here moves its folder of
cards to the new name, review history and all; a rename made in Obsidian
starts a new folder and leaves the old one. Cards used to live in a study
subject, under `<subject home>/Flashcards/Glossary/<Glossary name>/`; the
first sync of a glossary moves any files still there into its deck's
folder, adding ` (cards)` to their names, review history and all.

## Flashcards

Flashcards are the glossaries' terms: a glossary whose cards are on is a
**deck** (see Glossary), and nothing else in the vault is reviewed. The
Flashcards page, `/flashcards`, shows the cards to review today across every
deck with **Review all**, the number of new cards a day, and each deck with
its cards due, new today and in all, a Review button, and its categories as
chips, each with the cards ready in it and linking to a review of just that
category. A review is `/flashcards/review`, or `?deck=<glossary slug>` for
one deck, and `&category=<name>` for one category of it.

**New cards a day.** Cards never reviewed join the reviews fifteen a day
across every deck together; the rest wait. The number is `new_per_day:` in
`_hub/flashcards.md`, set from the Flashcards page or in Obsidian, and 0
lets none in:

    ---
    new_per_day: 15
    ---

The day's cards are shared out a card at a time to whichever deck has begun
the fewest today, so fifteen over three decks is five each; a deck with
nothing left to learn gives its share to the others, and turning another
glossary's cards on changes the mix rather than the total. A glossary's own
`new_per_day:` caps its deck's share. Within a deck, the new cards are its
first ones never reviewed, by file path and then position in the file, so
the choice is stable through the day and the next ones follow tomorrow; a
deck that did its share this morning gets none of what is left. Review all,
a deck's review, a category's review, the counts on the page and Today's
card all use this rule, so they offer the same cards. A card's first review
is counted per deck and day in `_hub/.state/new-cards.json`, which is never
committed and holds only today; the review comments cannot tell a first
review from a later one, so the count is kept rather than worked out.

**A missed day costs new cards, not more cards.** Each review overdue (due
before today) holds back one of the day's new cards, the last that would
have joined, and the page says how many wait. A day's unused allowance is
never carried over either, so skipping a day makes the next one lighter in
new cards instead of heavier overall. Catching up a review lets its held card
in the same day: twelve reviews owed and fifteen new a day shows twelve and
three, and once the twelve are done the other twelve new cards follow.

**Reviewing.** Cards already reviewed come first, then the new ones, and
within each the decks take turns, a card from each, so a day with three
decks is a mix rather than three decks in a row. The queue is fixed when the
review opens. Cards are graded with the keyboard or a tap: Again, Hard, Good
or Easy, each button showing when the card would come back. Scheduling is
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
card is next graded. Grading never writes outside a deck's folder.

## Notes

Notes are read-only here: Obsidian is the editor. The list page searches the
whole vault, shows what changed recently, and offers the folder tree. A note
shows its rendered text beside its properties, tags, the notes that link to
it and the notes it links to; Browse opens the folder tree as a side sheet.

The capture box routes by its words (see Today): a timed line goes to
today's note, one naming a workspace to its board, and anything else to
`Inbox/Capture.md` under a `## <day>` heading. Those are the only things the
Notes module writes.

The private folder, `Private/`, never appears here: not in search, the tree,
backlinks or recent notes. A link straight to a private note is a 404.

## Study

Study is divided into subjects — CS, Filipino, whatever comes next. A
subject is one markdown file under `_hub/subjects/`, and there can be any
number; each is listed under Study in the rail. Subjects and workspaces
have nothing to do with each other: a subject is not a workspace, is not
listed among them, and claims no note or task for one, and a workspace
never shows in Study. Nothing is shared between two subjects but the code.

    ---
    name: Filipino
    color: "#7c3aed"
    folders:
      - "Study/Filipino"
      - "Languages/Filipino"
    ---

A subject's own files live in its home folder, the first folder its file
names (`Study/<name>` when it names none): `Goals.md` and `Reading
List.md`. Its notes come from every folder it names, so reference
notes kept elsewhere can sit beside the home as further folders, and, when
the file has a `tag:`, from any note carrying that tag. Flashcards are not
Study's; they are the glossaries' (see Flashcards). Folders, at the foot of a subject's Notes tab, adds or removes those:
the home stays first and never moves, and each change rewrites only the
`folders:` lines. The heading's Edit changes the name, description, colour
and tag in the same file, and Delete, after asking in place, removes that
one file and nothing else: the home folder and everything in it stay, and
git history still has the file.

Subjects used to be workspaces whose file said `template: study`. On start,
each such file still in `_hub/workspaces/` is moved to `_hub/subjects/`
byte for byte, unless a subject of that name is already there, in which
case both are left for you to sort out. Card files a subject used to hold
stay where they are: a glossary's are moved to its deck (see Glossary), and
anything else, such as Anki imports, is left untouched and unreviewed.

**The Study page** shows one card per subject — its goals with milestones
done out of total. New subject takes a
name and, optionally, reference folders, and writes the subject's file,
homed at `Study/<name>`; a name another subject already has is refused. A
workspace of the same name is no clash. The old single-subject addresses,
such as `/study/goals`, open that tab of the only subject, or this page when
there are several; `/study/flashcards` and `/study/review` open the
Flashcards page.

Every subject has four tabs, always shown, because a new subject should
invite filling in rather than hide: Overview, Notes, Goals and Reading list.
There is no time tracking: Sessions, which logged sittings against goals,
was taken out before it was ever used, and its old address opens the
Overview. A `Sessions.md` or a `weekly_hours:` left in a vault is ignored.

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
under one. Reading items each point at a goal, which is how
they gather under it: every goal picker in Study offers the same
list, the headings of `Goals.md` in order. A goal is matched by its name
ignoring case and punctuation, and one naming a goal that is no longer in
`Goals.md` counts as belonging to none.

**Overview shows one goal at a time**, as the steps it takes. The goal is
the one `focus:` in `Goals.md`'s frontmatter names; with none, or one no
longer there, it is the first goal with a step still open, so the order of
the headings is the order of priority, and finishing a goal moves on to the
next. Above it the goals sit in a row, numbered in that order with their
steps done out of total; picking one writes it as `focus:` (that line only),
so it stays the focus on every device until another is picked. A goal not
in focus whose next step is due within a week shows that date on its
button, red once it has passed.

The card gives the goal's target and the days left and its steps done,
then **Now**: the first open milestone, its due date and how far off it
is, with Done, which ticks it through the ordinary task rewrite. Below are
the reading items for the goal, Reading before To read, and every step in
order, each tickable, a cancelled one shown struck through and left out of
the count. A goal picked and finished says so and offers the next.

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

## Workspaces

A workspace is one markdown file under `_hub/workspaces/`. It is the whole
definition — its name, colour, tag, folders and which glossary
it points at — so
editing it here or in Obsidian is the same edit. The "edit definition" link on a
workspace's page goes straight to that file for exactly this reason; there is
deliberately no settings form that would rewrite it behind your back.
The one exception is **Folders**, at the foot of a workspace's Overview: it
lists the home, which never moves, then each
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
`Log.md`, a `CRM/` folder and a `Pages/` folder of custom pages all live
(and an older `Inbox.md`, read but no longer written). Glossaries are not
kept here; they have their own folder (see Glossary).

A line `glossary: <name>` points the workspace at the glossary of that name,
`Glossaries/<name>.md`, matched ignoring case; the glossary's look-ups read
the workspace's definition file for context. It is optional. Several
workspaces may name the same glossary, and renaming a glossary rewrites this
line in each of them.

A `template:` line is no longer read. It once made a workspace a study
subject; subjects now have files of their own (see Study).

Last of all, an `aliases:` list in the workspace file claims a task that names
the workspace in its own words: with `aliases: [eye2gene, e2g]`, the daily
block "10:30 - 18:00 Work on eye2gene" counts as eye2gene's time although no
tag says so. The match is whole-word and ignores case, and it is tried only
after the tag, the folder and a `workspace:` field have all come up empty, so
a note sitting in one workspace's folder is never reassigned by a word in its
text — in practice only daily notes and the Inbox are ever claimed this way,
and a capture naming an alias goes straight onto that workspace's board.
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

**Inbox** is the one inbox, `Inbox/Capture.md`, filtered to the lines that
carry the workspace's tag or name it by an alias, with the same exits
as the triage page (see Inbox); **Board** files straight onto this
workspace's board. Its capture box writes the same file with the
workspace's tag appended, so the line shows here. `<home>/Inbox.md` is no
longer written; while an old one still has open lines they are listed
read-only under the tab, to tick or move in Obsidian. An old `Tasks.md` is
an ordinary note now, not the board.

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

## Inbox

The triage page for `Inbox/Capture.md`: every line not yet dealt with,
grouped under the day it was captured, newest day first and in the order
written within a day. It is reached from Today's Inbox card, the evening
review, the palette's `i` and the rail's foot, and it is done when it is
empty.

Each line leaves by one of five doors, as a button or, with the row
focused, a key:

- **Today** (`t`) plans it onto today as a block with no time, linked back
  to `[[Inbox/Capture]]`, ready to drag onto the timeline. A bare bullet is
  first rewritten in place as a task line, `- 09:05 Call` becoming
  `- [ ] 09:05 Call`; the capture time is left out of the block. It needs
  today's note, and says so when there is none.
- **Board** (`b`) files its words as a card at the bottom of a board's first
  column, read the way quick-add reads them and without the capture time.
  The workspaces are offered to pick from, the one the line names first.
- **Note** (`n`) appends its words as a bullet to the end of a workspace's
  `Overview.md`, for a thought that belongs to the project rather than to
  its to-do list. The same picker, and the same words as a card would get.
  A missing Overview.md starts as that one bullet.
- **Study** (`s`) adds it to a study subject's `Reading List.md`, at the
  bottom of To read, for something to read, watch or work through. The
  subjects are offered to pick from, or it goes straight to the only one.
  The words are read the way the reading list reads any item, so a link is
  the item's link and a trailing `#book` is its kind. There is no Study
  button until there is a subject.
- **Drop** (`x`) does nothing else.

All five tick the line in the inbox, so the file stays a record of what
came in and the row leaves the list. Nothing is deleted. A line that changed
in the file since the page loaded is refused and the list reloads.

## Date

Everything here lives under `Private/`, a folder that is never committed,
never indexed, never searched and never shown anywhere else: not on Today,
not in Notes, not in the palette. It is backed up only by the whole-box
backup the Proxmox host already takes, because syncing it anywhere else would
be exactly the leak this module exists to prevent.

On a vault with no `Private/` folder, Date is left out of the rail and the
phone's More sheet, since it would have nowhere to keep anything.

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

**Likes** treats each like sent as a forecast to be scored. The outcome is
always the same: **yes means she replies after matching**, so a match she
never answers is a no. Logging one (on Likes, or under the counters on Log)
takes a nickname, not a full name, the day (today unless changed), a forecast
in 5% steps or any whole number, four tags (out of my league, fits my type,
liked on a photo or a prompt, commented) and an age. Each tag starts unknown
and stays so unless tapped. Unknown is never counted as no. A forecast of 0
is saved as 2 and 100 as 98, since nothing is certain. The like is
frontmatter on her person note, at stage liked:

    liked: 2026-10-01
    chance: 10
    status: pending
    resolved: 2026-10-09
    resolved_by: auto
    out_of_league: true
    fits_type: false
    age: 27
    liked_on: prompt
    commented: true

`liked:` and `chance:` are the names the app used before, so older notes
needed no renaming. When a like is first read, the app migrates its note:

- it gives it `status: pending`, or yes if her stage already says she replied;
- it clamps the forecast;
- it supplies a missing day from the note's last change and marks it
  `liked_migrated: true`.

A like still pending **seven days** after it was sent becomes no,
`resolved_by: auto`, dated the day the rule applied. You can still change it
afterwards. Each change rewrites only the lines it changes.

- **Pending list:** pending likes, oldest first, each showing how long it
  has waited, with a Yes and a No.
- **Yes:** also moves a person at liked or matched to talking.
- **Stage change:** moving someone to talking, date planned or dating
  resolves her pending like to yes. Matched does not, because a match is not
  a reply.
- **All likes:** every like, filterable by outcome, each opening an editor.
  The nickname is the note's name and is not edited there.
- **My type:** your own note, `Private/Dating/Type.md`, shown beside "fits
  my type" and edited in place.
- **Export and import:** export downloads every record as JSON. Import takes
  that file, or the old shape named the way the notes spell it (`name`,
  `liked`, `chance`, `stage`). It adds likes that are missing and fills in or
  corrects the ones that exist. It never clears a field and never deletes.

Stats scores the resolved likes only:

- **Base rate:** yes ÷ resolved.
- **Bias:** mean forecast less the base rate, in percentage points. Below
  zero, the forecasts run pessimistic.
- **Brier score:** shown next to the Brier of always forecasting the base
  rate.
- **Calibration table:** forecasts of ≤5%, 6–15%, 16–30% and ≥31%.
- **Splits:** by each tag and by age band (<25, 25–26, 27–30, 31+). A like
  whose tag is unknown is left out of that split.
- **Type share:** the share of likes that fit your type, counted over every
  like where you said, pending ones included.

Every group shows its n. One under ten says "not enough data" instead of its
numbers.

## Sync

The index — notes, tasks, links, tags — is rebuildable and never
authoritative. Deleting it and letting prosoche rebuild it from the vault is
always safe, because the vault is the only thing that actually holds state.

Automatic commits only ever stage files this app wrote; anything changed by
hand in an editor waits on this page for a person to choose, rather than
being swept up automatically.

**Suggest**, beside the commit message, has a model read the diffs of the
ticked files and fill the box with one line, `docs(<scope>): <summary>`, such
as `docs(glossary): add ten networking terms`. It uses the Commit message
row on Settings, Haiku at low effort by default, and shows only when AI is on.
It only fills the box: you can edit the line, and nothing is committed until
you press Commit and push.

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

The model picker offers whatever Claude Code itself offers. The CLI keeps
its model list in `~/.claude/cache/model-catalog/` and refreshes it on its
own, so a newly released model appears here the next time the page loads,
without updating prosoche. The models prosoche ships with are always offered
too, so a setting that names an older model stays valid. A model that is not
on offer falls back to that feature's default, which is Sonnet 5.5.

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
