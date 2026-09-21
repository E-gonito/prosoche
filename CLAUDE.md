# CLAUDE.md

Guidance for any agent or contributor working in this repository. Read
`README.md` first for what the project is.

## Non-negotiables

- **Markdown in the vault is the only source of truth.** SQLite is a
  rebuildable cache. Never store state the vault cannot express.
- **Preserve every byte the user did not change.** Task edits rewrite a single
  line through character spans. Never re-serialise a note from a parsed model.
  Never reorder lines, including where the UI displays them sorted.
- **`vault-conformance.test.ts` is the safety net.** It rewrites every task in
  a real vault and asserts the bytes are unchanged. If it fails, stop and fix
  the parser rather than the test.
- **Filesystem access lives only in `src/lib/server/vault/`.** SQL lives only
  in `src/lib/server/index/`. If you are reaching for `node:fs` or a `SELECT`
  anywhere else, the abstraction is in the wrong place.
- **Never write to the vault from a language-model code path without an
  explicit accept step.** Output a proposal; let a human apply it.

## Design

The codebase follows John Ousterhout's *A Philosophy of Software Design*.
Complexity is what makes code hard to understand or change; it arrives in
small increments, so each change must leave the code no more complex than it
found it.

1. **Deep modules.** Few modules, small interfaces, a lot hidden behind each.
   A route handler talks to one module, never to the filesystem or the database.
2. **Information hiding.** Each file format, SQL statement and git command
   exists in exactly one place. Nothing outside `parse/task.ts` knows the task
   line grammar.
3. **No pass-through methods.** A function that only forwards to another either
   needs real work or needs deleting. Prefer one general function with a few
   parameters to several special-purpose ones.
4. **Pull complexity downward.** Handle the edge case inside the module so
   callers stay simple. Define errors out of existence where you can: a missing
   note reads as empty, a clashing write returns a conflict rather than
   throwing, a malformed line is kept verbatim and reported once.
5. **Different layer, different abstraction.** Route handlers translate HTTP.
   Components render data and emit intent. Neither contains domain logic.
6. **Design it twice.** For a new module, sketch two interfaces and say in the
   pull request why you picked one.
7. **Comments say what the code cannot.** Every exported function states its
   contract: inputs, outputs, side effects, and what it will never do. Write
   the interface comment before the implementation. Never restate the code.
8. **Consistency.** One naming scheme, one error style, one place for config.
9. **Tests as design pressure.** Parsers and rewriters are pure and
   table-tested. A test that is hard to write means the interface is wrong.

## Conventions

- Paths crossing a module boundary are vault-relative and POSIX-separated.
  Absolute paths exist only inside the vault module.
- Dates are `YYYY-MM-DD` strings. A calendar day is a label, not an instant.
- Times are minutes since midnight once parsed.
- Light theme only.

## Checks

```bash
npm test          # must pass
npm run check     # must be clean
VAULT_PATH=~/vault npm test   # before touching anything in parse/
```
