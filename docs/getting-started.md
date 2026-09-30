# Getting started

Ten steps from nothing to a planned, reviewed day. You need Node 22 or newer
and an [Obsidian](https://obsidian.md) vault on the same machine. prosoche
reads the vault and writes single lines into it; it keeps nothing of its own
that the vault cannot rebuild.

## 1. Run it

```bash
npm install
HUB_VAULT=~/vault npm run dev      # http://localhost:5173
```

It has no login. Keep it on your own machine or a private network. The other
settings are in the README.

## 2. Set up Obsidian's daily notes

In Obsidian, Settings, Daily notes:

- **New file location:** `Journal` (not `Journal/2026`).
- **Date format:** `YYYY/MM/DD`, which gives `Journal/2026/09/30.md`.
- **Template file location:** `Journal/Journal Template`.

prosoche looks for the day's note at exactly that path, and creates it from
that template when you ask.

## 3. Put a task list in the template

Edit `Journal/Journal Template.md` down to what you do most days, with a time
on each line:

```markdown
# Tasks
- [ ] 07:30 - 08:00 Morning stretch `Q1`
- [ ] 22:30 - 22:40 Write the daily log `Q1`
```

A line with a time range lands on the timeline. A line without one is
unscheduled. Anything under `# Tasks` is read; nothing else in the note is
touched.

## 4. Open today

Open Today. If the note is not there yet, press **Create today's note**. It
copies your template byte for byte to the day's path. Nothing else ever
creates a daily note, so if you use Obsidian on another device, let it sync
first.

A task line is a checkbox, an optional time range, the text and an optional
priority:

| Written | Means |
|---|---|
| `- [ ]` | open |
| `- [x]` | done |
| `- [-]` | skipped: struck through, counted as neither done nor owed |

## 5. Plan the day by dragging

Under "From your workspaces", each open board card has a ⠿ grip. Drag one
onto the timeline to give it a time, or onto the unscheduled list to plan it
without one. A block linking to the card is added under `# Tasks`; the card
stays on its board. Drag a block to move it and its bottom edge to resize it.

## 6. Priority and workspace

`Q1` to `Q4` in backticks is the Eisenhower priority: `Q1` urgent and
important, `Q4` neither. A `#ws/<slug>` tag on a line puts that task in the
workspace with that slug. A workspace can also list `aliases:` in its file, so
"Work on Kaya" counts as Kaya's time with no tag at all.

## 7. Capture from anywhere

The box at the top of Today's Unscheduled list adds a task to the day: with
a time range (`10:00 - 10:30 Dentist`) it lands on the timeline, without one
it waits in the list until you drag its ⠿ grip onto an hour.

Press `c` for a capture box anywhere, or share to the app from your phone.
Those lines go where their words say:

- a time range goes into today's note and onto the timeline;
- `#ws/<slug>` or a workspace alias puts it on that workspace's board;
- anything else lands in `Inbox/Capture.md` under today's date.

`k` adds a card the same way. Press `mod+k` (Ctrl K, or Cmd K on a Mac) for
the command palette, which searches notes, tasks and workspaces and runs any
command.

## 8. Empty the inbox

Today's Inbox card lists what is waiting. Press `i` to open the triage page.
Each line has four exits: `t` plans it onto today, `b` files it as a card on
a board you pick, `n` appends it to a workspace's Overview note, `x` drops it. Each ticks the line in the inbox file, so
nothing is deleted.

## 9. Add workspaces

A workspace is one file in `_hub/workspaces/`, such as
`_hub/workspaces/kaya.md`:

```markdown
---
name: Kaya
color: "#2f6fed"
tag: ws/kaya
aliases: [kaya]
folders:
  - "Kaya"
---
```

The first folder is its home, where `Board.md`, `Overview.md`, `Log.md`, `CRM/`
and `Pages/` live. Or use **New workspace** on the Workspaces page, which
writes that file for you. A section with nothing in it stays hidden.

## 10. Review the day

Press `r`, or follow **Review the day** on Today (it appears from 18:00). On a
phone it is the Review tab. Every task in the note has a large tick and a
Skip; each press changes one character on one line. The top shows done,
skipped and open, and the bottom shows how many lines are still in the inbox.

## Keys

| Key | Does |
|---|---|
| `mod+k` | Command palette, also while typing |
| `c` | Quick capture |
| `k` | New card |
| `r` | Review the day |
| `i` | Inbox triage |
| `t` `w` `l` `d` `g` `y` | Go to Today, Workspaces, Glossary, Study, Notes, Sync |

A key does nothing while you are typing in a box. Date has no key on purpose.
Settings has none either; open it from the rail or the palette.

More on how each screen behaves is in [how-it-works.md](how-it-works.md).
