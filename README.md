# prosoche

A daily planner and project hub that reads and writes an [Obsidian](https://obsidian.md)
vault directly. Your notes stay plain markdown on disk. The app is a lens over
them, not another place your data lives.

*Prosoche* (προσοχή) is the Stoic word for continuous attention: noticing what
you are actually doing, as against what you meant to do. That is the whole
premise. The plan you wrote this morning and the day you actually had are the
same file.

> Working, and in daily use by its author. It has no login and is meant to
> run on a private network.

## Why

Obsidian is a very good editor and a poor dashboard. Plugins can give you a day
planner, a kanban board and a spaced-repetition deck, but they do not talk to
each other, and none of them will tell you that the project you marked as your
priority got no time this week.

The alternative is usually a hosted tool that owns your data. prosoche takes
the other route: everything it knows is derived from markdown files you already
have, and deleting the app loses nothing.

## Principles

1. **Markdown is the only source of truth.** The SQLite index is a cache.
   Delete it and it rebuilds.
2. **Never reformat a note.** Editing a task changes the checkbox, the time
   range or the priority tag, in place, through character spans. Trailing
   whitespace, sub-bullets and syntax the parser does not model all survive
   byte for byte. A conformance test proves this over a whole real vault.
3. **Nothing reorders lines.** Your note stays in the order you wrote it, even
   where the app displays it sorted.
4. **Work with the conventions already in the vault**, rather than imposing new
   ones. It reads the [Day Planner](https://github.com/ivan-lednev/obsidian-day-planner)
   time-block format and an inline-code priority tag, because that is what was
   already there.

## What it reads

A daily note at `Journal/YYYY/MM/DD.md` containing tasks like:

~~~markdown
# Tasks
- [x] 09:30 - 10:00 Morning stretch `Q1`
- [ ] 23:00 - 23:10 Write the daily log `Q1`
	- What am I avoiding, and why
- [-] 12:00 - 12:30 Walk the dog `Q3`
- [ ] Refill the water, sweep the yard #ws/home `Q2`
~~~

`[ ]` is open, `[x]` done and `[-]` skipped. A time range puts the line on the
timeline. `Q1` to `Q4` are Eisenhower quadrants, written as inline code. A
`#ws/<slug>` tag puts a task in a workspace, as does a workspace's own alias
for it. Everything else is ordinary Obsidian: wikilinks, tags, frontmatter.

New here? [`docs/getting-started.md`](docs/getting-started.md) takes you from
`npm install` to a reviewed day in ten steps.

## Modules

Seven tabs, drawn from one registry (`src/lib/modules/index.ts`):

- **Today** — the day and the week around it: the timeline, board cards to
  drag onto it, an inbox card and an evening review.
- **Glossary** — one file per glossary, with Claude look-ups, a scan of your
  notes for new terms, and a switch that makes its terms flashcards.
- **Flashcards** — one deck per glossary, filtered by category, scheduled by
  FSRS, with a shared number of new cards a day across every deck.
- **Workspaces** — a kanban board, overview, inbox, log, contacts and notes,
  each defined by one file in `_hub/workspaces/`.
- **Study** — subjects with goals, a reading list and sessions, each defined
  by one file in `_hub/subjects/`. A subject's Overview walks one goal at a
  time, step by step.
- **Date** — a private counter ledger, person profiles and scored like forecasts under a gitignored
  `Private/` folder.
- **Notes** — a read-only Obsidian viewer with search and backlinks.

Beside them: an **Inbox** for triaging captures, **Sync** for git, and
**Settings** for the AI layer.

## Running it

Requires Node 22 or newer and a vault on the same machine.

```bash
npm install
HUB_VAULT=~/vault npm run dev      # http://localhost:5173
```

| Variable | Default | Meaning |
|---|---|---|
| `HUB_VAULT` | `~/vault` | The Obsidian vault to read |
| `HUB_DB` | `~/.local/state/hub/index.db` | Index cache; safe to delete |
| `HUB_UNDO` | `~/.local/state/hub/undo` | Snapshots taken before any AI write |
| `HUB_PEOPLE_FOLDER` | `People` | Where a person note is created |
| `HUB_GCAL_ICS` | — | Google Calendar's secret address in iCal format. Absent means no calendar events on Today |
| `HUB_T3_URL` | — | Base URL of a T3 Code web client on this machine. Absent means no "T3 Code" entry in the nav or palette |
| `PORT`, `HOST` | `3000`, `0.0.0.0` | For the built server |

No secret is ever written into the vault or this repository; a feature that
needs one and does not have it renders a "not connected" state naming the
variable to set, which is what it ships as.

Production is a single Node process:

```bash
npm run build
HUB_VAULT=~/vault node build/index.js
```

It has no login. Run it behind something that does, or on a private network
such as a [Tailscale](https://tailscale.com) tailnet, which is how it is meant
to be used.

## The AI layer

Off by default, and it never writes without a click. Every model run is
read-only: the CLI gets no tools and no directory and sees only the notes the
server puts in its prompt. Four features use it (glossary look-up and scan,
the morning briefing and Date insights), and each returns a proposal or a list
you accept or reject before a byte is written. Nine guardrails enforce this in code, not in
prompt text. The details are in [`docs/how-it-works.md`](docs/how-it-works.md#settings).

## More

- [`docs/getting-started.md`](docs/getting-started.md): first day, step by step.
- [`docs/how-it-works.md`](docs/how-it-works.md): what each screen does.
- [`docs/design.md`](docs/design.md): the token scale and shared classes.
- [`docs/contributing.md`](docs/contributing.md): tests and how the code is put together.
- [`docs/deploy.md`](docs/deploy.md): where the live copy runs and how it deploys.

## Roadmap

- [x] Vault reading, full-text index, git sync, rendered notes
- [x] Timeline with drag-and-drop, task ticking, conflict resolver
- [x] Seven modules, kanban boards, contacts, evening review, one inbox
- [x] Read-only AI: glossary look-up and scan, briefing and Date insights,
      behind an accept step
- [x] Flashcards from glossaries, scheduled by FSRS, a shared daily limit
- [x] Command palette, phone and desktop, installable to the home screen
- [ ] Multi-vault, and a second sync provider to prove the interface
- [ ] Outlook calendars, deferred behind Google's ICS feed

## Licence

MIT. See [LICENSE](LICENSE).
