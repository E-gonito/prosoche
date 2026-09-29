# Plan: Study v2, a fresh Study/ folder with goals as topics

Written 2026-09-29, after an interview with the author. Items marked
**default** were not asked and stand unless the author says otherwise.

## Why

The study workspace (CS study, `template: study`) points at the whole of
`Computer Science/`, 119 reference notes. Study infers everything from that:
the reading list is any note with `media_link:` or `#Video`, topics are
folders three levels deep, and flashcards are the three notes that happen to
carry Spaced Repetition syntax. It does not track what the author is actually
studying. `Goals.md` and `Sessions.md` do not exist.

## Decisions

1. **A fresh `Study/` folder is the study workspace's home.** It holds the
   plan: `Goals.md`, `Reading List.md`, `Sessions.md` and `Flashcards/`.
   `Computer Science/` stays as reference notes, untouched, and is kept as
   the workspace's second folder so its notes stay in scope for flashcards and
   "Make cards". The workspace definition becomes
   `folders: ["Study", "Computer Science"]`. The lead makes that edit after
   merge; code must not assume it.
2. **Goals are the topics.** A goal is a `## ` heading in `Goals.md` (the
   grammar in `study/goals.ts` is kept: `target::` date, milestones as task
   lines). Reading items, sessions and flashcard files each point at a goal,
   so progress rolls up by goal. Folder-derived and syllabus-derived topics
   stop being shown (**default**: remove the topic map from Overview. Keep
   `topics.ts`'s scope helpers, which others use).
3. **The reading list is one editable file, `Study/Reading List.md`,** that
   prosoche owns, the same way as a workspace's `Board.md`. You can add, edit,
   remove and reorder items. Each item has a title, a link (optional), a kind
   (book, course, video, article, paper, other), a status and a goal
   (optional). **Reuse the kanban grammar** (`parse/kanban.ts`, which gives
   byte-exact moves, edits and Obsidian Kanban compatibility), so the file is
   a board with columns To read · Reading · Paused · Done. It is shown as
   grouped lists rather than a board (**default**), and its edit form has
   Kind and Goal pickers. How an item's link, kind and goal are stored in the
   card line is the builder's call; it must still read well in Obsidian.
   Suggested:
   `- [ ] [CS:APP](https://csapp.cs.cmu.edu) #book [[Goals#Computer Systems]]`.
   Add a delete-card operation to the kanban grammar; the board can use it too.
   The old inferred reading list (`study/resources.ts`) is removed once
   nothing uses it.
4. **Sessions point at a goal.** `Sessions.md` keeps its grammar
   (`- YYYY-MM-DD 1h30m [[…]] note`). The log form picks a goal and writes
   `[[Goals#<goal>]]`. Hours roll up per goal. Old `[[Topic]]` links still
   read, and are shown as they are.
5. **Flashcards belong to a goal through their file.** A card file's
   frontmatter `goal: <goal name>` puts all its cards under that goal. The
   Flashcards tab lists card files grouped by goal, with a picker to set a
   file's goal (a one-line frontmatter span edit through
   `parse/frontmatter.ts`). Review can be run for all cards or one goal.
   Card discovery (SR syntax, `#flashcards` tag or an existing SR comment)
   is unchanged and runs over the workspace's folders.
6. **"Make cards" on a note.** The note view (`/notes/...`) gets a button for
   any note in the study workspace's folders. It calls the existing
   `ai/suggest-cards.ts` (a proposal: nothing is written until accepted).
   Accepted cards go into the note, as that module already does. It currently
   has no UI.
7. **Import the 80 Anki decks** (`Flashcards/**/*.txt`, Anki's tab-separated
   export with `#deck:` and `#tags:` headers and HTML answers). This is a
   one-time, user-started import:
   - Each deck becomes one markdown card file under
     `Study/Flashcards/<deck path>.md`, with a `#flashcards/<deck>` tag.
   - Each card uses Spaced Repetition syntax: an inline `Q::A` when both
     sides are one line, otherwise the multi-line `?` form. HTML is converted
     to markdown (`<br>`, `<b>`, `<i>`, lists, entities, `<img>` kept as a
     link).
   - Review history starts fresh.
   - The page shows a preview first (decks, card counts, a sample card each)
     and writes only on **Import**.
   - It never overwrites an existing file (**default**: skip it and say so).
   - The `.txt` files are never modified.
   - Each file's `goal:` is left empty, for the author to set on the
     Flashcards tab.

## Scope and rules

- CLAUDE.md applies: markdown is the truth, span edits, Filesystem only in
  `vault/`, table-tested parsers, contract comments, no model writes without
  an accept step.
- A missing `Goals.md`, `Reading List.md` or `Sessions.md` reads as empty,
  and the first write creates it.
- Study's tabs: Overview, Goals, Reading list, Sessions, Flashcards. Every
  tab always shows (**default**): a fresh study area should invite filling
  in rather than hide.
- The Overview shows each goal with its milestones, this week's hours, reading
  in progress and cards due, all grouped by goal.

## Revision: subjects

After this plan was written the author asked for Study to cover more than
CS. A subject is any workspace with `template: study`; each has its own
home folder with the files above, its own pages under `/study/<subject>`
(review at `/study/<subject>/review`, `?goal=<slug>` for one goal), and
its cards from all of its folders. `/study` lists the subjects, reviews
everything due at `/study/review`, and creates a subject homed at
`Study/<Name>`. Decision 1 now reads "a subject's home folder" wherever it
says `Study/`, and `studyHome(workspaces, slug)` in `study/subjects.ts` is
where a subject's files go, the Anki import's included.
