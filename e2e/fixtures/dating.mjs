/**
 * A dating person, for the People and stage-change tests.
 *
 * Deliberately does not touch `Private/Dating/Ledger.md` — `notes.mjs`
 * already seeds that path with one line for 2026-09-01, and this file's name
 * sorts before `notes.mjs` alphabetically, so writing the same path here
 * would just be overwritten by it. Simplest to leave the ledger alone: the
 * one line stays as `notes.spec.ts` expects it, and `dating.spec.ts` writes
 * the rest of the ledger itself, through the app, as it runs.
 */
export default () => ({
	// The base vault template (`e2e/make-vault.mjs`, off limits to every module
	// agent) has no `.gitignore`, so without this line the fixture's own
	// `git add -A` would track Private/Dating/Ledger.md from the very first
	// commit — exactly the byte this module must never let git see. If some
	// other module's fixture ever adds its own whole-file `.gitignore` and
	// sorts after `dating.mjs` alphabetically, it will silently replace this
	// one; whoever adds that should fold this line into theirs.
	'.gitignore': 'Private/\n',
	'Private/Dating/People/Ada.md': `---
type: person
app: Hinge
age: 29
place: London
job: Researcher
stage: talking
---

Met through a mutual friend.

## Dates
- 2026-09-10 First coffee rating:: 4 notes:: good chat
`
});
