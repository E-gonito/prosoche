# Plan: Study as one block, one step, one button

Written 2026-10-21, after a conversation with the author. Built 2026-10-21,
with these differences from what follows:

- A skipped session with no block writes nothing at all, rather than a
  ticked-or-unticked block (decision 8).
- The tab row is Session, Plan, Notes, Goals, Reading list. The session card
  itself has no tab row, only a link to Plan. Goals and Reading list keep
  their own pages instead of folding into Plan.
- Today's Study card is unchanged: it opens the subject's card, one click
  from Start. A direct Start link on Today is not built.
- Replan stays on Plan, as the plan said.
**default** marks a choice the author was not asked about.

## Why

Study asks two questions before any work starts: which topic, then which
step. A subject's Overview shows goal pills, a progress bar, a behind-schedule
banner, the step to do now, the tutor, resources, every step and the
principles, all at once. Planning and studying sit on the same screen.

The journal shows the result. Since 1 September about 106 study lines were
written into daily notes and 6 were ticked (a keyword count, so it misses
study done without a tick). Most days carried three or four vague lines,
copied from the template and never given a time: "Learn CS:APP and continue
the Programming Learning Plan", "Learn Frontend (React.dev)", "Read pages off
a book". An open line stopped meaning anything.

The fix is to decide in the planning moment, when the author time-blocks the
day in Obsidian, and leave nothing to decide when the block arrives.

## Decisions

1. **A daily-note block names one subject, and that is the whole decision.**
   `- [ ] 17:00 - 17:30 Study Fullstack `Q2`` means: at 17:00, Fullstack, for
   30 minutes. A task line matches a subject when its text contains the
   subject's name or one of its `aliases:`, ignoring case. The first match
   in file order wins (**default**).
2. **One subject on screen.** A session shows one subject and its one step,
   never a choice between subjects.
3. **One active goal per subject.** The goal `focus:` names in that
   subject's `Goals.md` (which already exists, see `study/goals.ts`) is the
   active one. The others are its queue, in file order. The step is always the
   active goal's first open milestone. Nobody picks a step to start a session.
4. **The `first::` line leads.** The step is shown with its `first::` line
   (the smallest action that gets you moving) above everything else, then its
   `est::`. A step with no `first::` shows its own text alone.
5. **Session length comes from the block.** `17:00 - 17:30` is 30 minutes.
   A line with no times, or a session started from the Study page with no
   block, is 30 minutes.
6. **"+15 min" extends the session and the block.** It moves the block's end
   time in the daily note with the existing guarded task edit (`TaskEdit.time`,
   the same span edit as dragging on the timeline). With no block, it only
   extends the timer.
7. **Ending asks one question: Done, Made progress, or Didn't get to it.**
   - Done ticks the step (the existing task rewrite) and ticks the block.
   - Made progress ticks the block, not the step.
   - Didn't get to it ticks neither.
   - All three write one sub-bullet under the block:
     `	- Fullstack: <step text>, 25m, progress`. The scratch box's text, if
     any, follows on the same line after ` · `.
   Showing up is the habit, so "made progress" counts as a session.
8. **The daily note is the session log.** There is no `Sessions.md`. The
   sub-bullet is a single-line insertion directly under the block's line,
   guarded by the note's hash. When there is no block (started from Study),
   a new block is appended to today's `# Tasks` with the real start and end
   time, ticked or not as in 7, then the sub-bullet goes under it.
9. **Feedback is one quiet number:** sessions and minutes this week, counted
   from those sub-bullets. No red for late milestones and no "replan" banner on
   the session screen. Dates stay in `Goals.md` for the Plan tab.
10. **A running session lives in `_hub/.state/study-session.json`**, which git
    sync already treats as transient and never commits. Closing the tab or
    switching device keeps it running, and opening Study returns to it.
    One session at a time (**default**).

## Screens

**`/study`** keeps the subject list, plus one card at the top when today's
daily note has a study block that has not happened yet (**default**: the next
upcoming one, else the latest unticked one).

**`/study/<subject>`, the default tab, becomes the session card:**

```
  Study Fullstack · 30 min

  Next: Finish react.dev Learn chapters Describing the UI, …
  Start with: Set a 20-minute timer and write what you remember …

            [ Start ]

  This week: 2 sessions · 1h 10m
```

**Start** opens the focus view at `/study/<subject>/session`: the timer
counting down, the step, the `first::` line, a scratch box, "+15 min" and End.
Nothing else.

**The other tabs** become one **Plan** tab holding the goals and their queue,
the reading list, the principles, the tutor and the old Overview's detail.
The Notes tab stays. Changing the active goal is done here (it writes
`focus:` as `study/goals.ts` already does).

**Today:** the existing study card (`studyNext` in `modules/today.server.ts`)
gains a Start link on a matching block, which opens the same focus view.

## Vault changes (the author applies them, or approves each one)

Nothing below is written by code. It is listed so it can be checked first.

**New subject files in `_hub/subjects/`:**

| File | name | Home folder | aliases |
|---|---|---|---|
| `fullstack.md` | Fullstack | `Study/Fullstack` | Frontend, React |
| `systems.md` | Systems | `Study/Systems` | CS:APP, APoSD, DDIA |
| `rust.md` | Rust | `Study/Rust` | leyline-front, leyline-frontline, Rust Game |

**Goals moved out of `Study/Computer Science/Goals.md`, verbatim:**

| To | Goals, in this order | `focus:` |
|---|---|---|
| `Study/Fullstack/Goals.md` | Frontend Depth, Rails Backend | Frontend Depth |
| `Study/Systems/Goals.md` | Finish APoSD (split out of Systems and Design: its three APoSD steps), CS:APP (its two CS:APP steps), DDIA (new, no steps yet), HTTP Server from Scratch, Interview DSA | Finish APoSD |
| `Study/Rust/Goals.md` | Rust via leyline-front | Rust via leyline-front |

Reading-list items that link `[[Goals#Rails Backend]]` move to Fullstack's
`Reading List.md`. The Computer Science subject keeps its reference folders
and the Principles until the author decides what it becomes (**default**:
left as it is, not deleted).

**Journal template, `# Tasks`:** "Study Computer Science", "Work on
leyline-front" and "Read pages off a book" are replaced by:

```markdown
- [ ] Study Fullstack `Q2`
- [ ] Study Systems `Q2`
- [ ] Study Rust `Q2`
```

with the habit: during "Set out tasks for the day", give a time to the study
lines that will happen today and delete the rest.

## What this keeps from earlier plans and what it reverses

- Keeps goals as `## ` headings, milestones as task lines, `focus:`, `first::`
  and `est::`, the reading list, and the tutor.
- Reverses "Sessions are gone": sessions come back, but as sub-bullets in the
  daily note, not a separate file.
- Removes the Overview's behind-schedule banner and replan button from the
  default view. Replan moves to Plan (**default**: kept there, not deleted).

## Build order

1. `aliases:` on subject files, and `blockFor(day, subject)`: the matching
   task line in today's note. Pure matcher, table-tested.
2. Session state in `_hub/.state/study-session.json`: start, extend, end.
3. Ending: the three outcomes as task edits plus the sub-bullet insertion,
   one guarded write each. Tested against a copy of a real daily note, and
   `vault-conformance.test.ts` must still pass.
4. The session card and focus view. The Plan tab takes the old Overview,
   Goals and Reading tabs.
5. The Today card's Start link, and the week's count.
6. e2e: start from Today, extend, end with each outcome, and check the daily
   note's bytes.

## Not now

The near-term plan is to finish CS:APP, APoSD and the Rust game, learn
frontend then backend, and later Interview DSA and Systems Design. These are
all goals in the three subjects, so nothing in this design needs to change
when they come up. Rotating between subjects automatically, streaks and
notifications are out.
