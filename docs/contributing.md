# Contributing

Read [`CLAUDE.md`](../CLAUDE.md) first: it holds the non-negotiables (markdown
is the only source of truth, every byte the user did not change is kept,
filesystem access lives in one folder, no model writes without an accept
step) and the design rules the code follows. For what a screen does, see
[`how-it-works.md`](how-it-works.md); for the CSS, [`design.md`](design.md).

## Tests

```bash
npm test                              # 1400+ unit tests, no vault needed
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
search, `chokidar` to watch the vault, `simple-git` for sync and `ts-fsrs` for
flashcard scheduling.

| Module | Owns |
|---|---|
| `src/lib/server/parse/` | Task lines and note structure, including `[ ]`, `[x]` and `[-]`. Pure functions. |
| `src/lib/server/vault/` | Every filesystem call, path safety, hashes, the watcher, the sync provider. |
| `src/lib/server/index/` | The database. The only SQL in the codebase. |
| `src/lib/server/tasks.ts`, `day-plan.ts`, `capture.ts`, `inbox.ts` | Single-line task rewrites, planning a task onto a day, capture routing, the one inbox. |
| `src/lib/server/workspaces.ts`, `kanban.ts` | Workspace definitions and membership, and the byte-exact `Board.md` edits. |
| `src/lib/server/study/` | Flashcards, glossary cards, resources, goals and the session log, all read out of notes. |
| `src/lib/server/dating.ts` | The ledger, person profiles and the `Private/` scope, read by one module only. |
| `src/lib/server/ai/` | The nine guardrails, `run.ts` (the one read-only runner), the CLI bridge, and the three features. |
| `src/lib/server/hub.ts` | Wires those into one running instance; `hub()` resolves once the first index build is done. |
| `src/lib/shared/` | Pure code both sides import, such as `scheduler.ts`, the one file that imports `ts-fsrs`. |
| `src/lib/client/` | Browser-only code: the one `api()` transport, the palette and shortcuts, drag state. |
| `src/lib/modules/` | The module registry the shell draws its navigation from. |
| `src/routes/` | Pages and JSON API. Handlers translate HTTP and nothing else. |

**A JSON route** is validation plus one call into a domain module, wrapped in
`route()` from `src/routes/api/route.ts`. The wrapper parses the body, awaits
the hub, and turns a `{ ok: false, reason }` answer into a status and a
sentence from one table. A handler never builds a `Response`.

**The browser** reaches the server through one function, `api<T>(path, body?,
{ method })` in `src/lib/client/api.ts`. It returns a `Result<T>` and never
throws: a conflict or an offline phone is data to render.

**The AI layer** has one runner, `runDraft` in `src/lib/server/ai/run.ts`. It
checks the kill switch and budget, runs the CLI read-only, validates any JSON
against a schema and writes the audit line. Briefing, Date insights and glossary
look-up are built on it. What a feature returns is a proposal, applied only
through `proposal.ts` after the user accepts.

**Flashcard scheduling** is `src/lib/shared/scheduler.ts`. The server grading a
card and the review screen labelling its buttons call the same function.
`study/flashcards.ts` owns how the state is written into a note, in
`<!--fsrs:…-->` comments.

Sync sits behind a `SyncProvider` interface with a git implementation: saves
write to disk immediately and are committed on a debounce, pulls run on a
timer, and conflicts are reported as data rather than thrown. Swapping git for
something else is a new implementation, not a rewrite.

The design follows John Ousterhout's *A Philosophy of Software Design*: deep
modules behind small interfaces, complexity pulled downward, and errors defined
out of existence where possible. Reading a note that does not exist returns an
empty note. Writing returns a conflict instead of throwing one.

`docs/how-it-works.md` is checked against `src/routes` by
`src/how-it-works.test.ts`: a `##` heading with no route fails the test, so a
change that removes or renames a screen edits that page in the same commit.
`docs/design.md` is held to 150 lines and checked against `src/app.css`.
