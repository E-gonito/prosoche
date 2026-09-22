# prosoche

A daily planner and project hub that reads and writes an [Obsidian](https://obsidian.md)
vault directly. Your notes stay plain markdown on disk. The app is a lens over
them, not another place your data lives.

*Prosoche* (προσοχή) is the Stoic word for continuous attention: noticing what
you are actually doing, as against what you meant to do. That is the whole
premise. The plan you wrote this morning and the day you actually had are the
same file.

> Working, and in daily use by its author. The planner, boards, time tracking,
> study and the AI layer are all in. It has no login and is meant to run on a
> private network.

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
- [ ] Walk the dog, refill the water, sweep the yard `Q1`

## Backlog
```
- [ ] Driving licence `Q2`
```
~~~

Tasks inside that fenced block are shown as a backlog and never edited, because
Obsidian treats them as text rather than tasks.

`Q1` to `Q4` are Eisenhower quadrants, written as inline code. A `#ws/<slug>`
tag on a line puts that one task in a workspace, wherever the line lives.
Everything else is ordinary Obsidian: wikilinks, tags, frontmatter.

Workspaces are markdown too. One file per workspace under `_hub/workspaces/`
declares where its notes live and which widgets appear on which tab, so the
layout is editable in Obsidian and travels with the vault. An `aliases:` list
in that file names the words you already use for the project — `aliases:
[eye2gene, e2g]` — so a daily block reading "Work on eye2gene" is counted
against it without your having to tag anything.

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
| `HUB_TIMESHEET_FOLDER` | — | Folder holding `TIMESHEET <MONTH>` notes, if you keep one |
| `HUB_GITHUB_TOKEN`, `HUB_GITHUB_REPOS` | — | Read access for the GitHub card. Absent means "not connected" |
| `HUB_LINEAR_TOKEN` | — | Personal API key for the Linear card |
| `HUB_T3_URL` | — | Base URL of a T3 Code web client on this machine. Absent means no "T3 Code" entry in the nav or palette |
| `PORT`, `HOST` | `3000`, `0.0.0.0` | For the built server |

No token is ever written into the vault or this repository; the cards render a
"not connected" state naming the variable to set, which is what it ships as.

Production is a single Node process:

```bash
npm run build
HUB_VAULT=~/vault node build/index.js
```

It has no login. Run it behind something that does, or on a private network
such as a [Tailscale](https://tailscale.com) tailnet, which is how it is meant
to be used.

## Tests

```bash
npm test                              # 951 unit tests, no vault needed
VAULT_PATH=~/vault npm test           # adds a conformance pass over your vault
npm run build && npm run e2e          # browser tests against a throwaway vault
```

Two suites matter more than the rest.

The **conformance** suite parses every task in a real vault, rewrites each one
with the values it already has, and asserts the bytes come back identical. If
that fails, the app would quietly reformat notes the first time it saved one.

The **end-to-end** suite drives the built server in a real browser against a
disposable vault built by `e2e/make-vault.mjs`, with its own git remote, and
checks the markdown on disk after every interaction. Ticking a task must change
one character on one line; dragging a block must change only its time. Each
test rewinds the fixture first, so none depends on another.

Playwright's Chromium needs some system libraries. On a machine without root,
`e2e/install-browser-deps.sh` unpacks them into a user prefix; point
`LD_LIBRARY_PATH` at it when running the suite.

## How it is put together

SvelteKit with `adapter-node`, SQLite through `better-sqlite3` with FTS5 for
search, `chokidar` to watch the vault, `simple-git` for sync.

| Module | Owns |
|---|---|
| `src/lib/server/parse/` | Task lines and note structure. Pure functions. |
| `src/lib/server/vault/` | Every filesystem call, path safety, hashes, the watcher, the sync provider. |
| `src/lib/server/index/` | The database. The only SQL in the codebase. |
| `src/lib/server/workspaces.ts` | Workspace definitions and membership. |
| `src/lib/server/timelog.ts` | The `## Time log` section, and the one running timer. |
| `src/lib/server/study/` | Flashcards, resources, topics and habits, all read out of notes. |
| `src/lib/server/ai/` | The ten guardrails, the CLI bridge, and every feature that drafts a change. |
| `src/lib/server/hub.ts` | Wires those into one running instance. |
| `src/routes/` | Pages and JSON API. Handlers translate HTTP and nothing else. |

Sync sits behind a `SyncProvider` interface with a git implementation: saves
write to disk immediately and are committed on a debounce, pulls run on a
timer, and conflicts are reported as data rather than thrown. Swapping git for
something else is a new implementation, not a rewrite.

The design follows John Ousterhout's *A Philosophy of Software Design*: deep
modules behind small interfaces, complexity pulled downward, and errors defined
out of existence where possible. Reading a note that does not exist returns an
empty note. Writing returns a conflict instead of throwing one.

For the fuller explanation behind what each screen's hint text only gestures
at, see [`docs/how-it-works.md`](docs/how-it-works.md). For the token scale,
the shared classes and the three shared components every screen is built from,
see [`docs/design.md`](docs/design.md).

## The AI layer

Off by default, and it never writes without a click. Every feature that would
change a note produces a **proposal** — the edits, the diff for each one, and
the reason — and writes only what you tick. Ten guardrails enforce that in
code rather than in prompt text: no direct writes, read-only by default, tool
runs in a sandbox copy of the vault rather than the vault, a per-feature path
policy, a blast-radius cap, schema validation of anything a model returns, a
budget, retrieved note text wrapped as data so a note cannot issue
instructions, an undo snapshot before every write, and a kill switch.

There is one exception, and it is stated where it lives: the morning briefing
may replace the text between its own two markers in today's note, and nothing
else, ever.

You choose the model, the effort level and the permission mode per feature, in
`_hub/ai.md` or on the settings page. With the layer off — which is how it
ships — every surface still loads and says so.

## Roadmap

- [x] Vault reading, full-text index, file tree, rendered notes, git sync, daily note view
- [x] Live-preview editor, ticking tasks, drag-and-drop timeline, conflict resolver
- [x] Kanban boards, workspace widgets, task dependencies
- [x] Time tracking, contacts and follow-ups
- [x] LLM assistance over the vault, behind an accept-or-reject proposal flow
      so nothing is written without confirmation
- [x] Study tracker: resource queue, topic coverage, spaced repetition
- [x] GitHub and Linear cards, command palette, installable on a phone
- [ ] Multi-vault, and a second sync provider to prove the interface

## Licence

MIT. See [LICENSE](LICENSE).
