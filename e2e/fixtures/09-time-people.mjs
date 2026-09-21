/**
 * Fixtures for phase 3: time and people.
 *
 * A person note in the shape the spec fixes, plus a working note that mentions
 * her and one that mentions somebody who has no note at all, because "a person
 * with no note reads as a person with an empty note" is a behaviour worth
 * having a fixture for.
 *
 * Nothing here adds a `## Time log` section: the tests make one, which is how
 * the append path gets exercised end to end.
 */
export default async function timeAndPeople() {
	return {
		'People/Ada Lovelace.md': `---
type: person
org: Acme
role: Analyst
workspaces: [work]
---

# Ada Lovelace

## Follow-ups
- [ ] Send the anonymisation plan \`Q2\` 📅 2026-09-23
- [x] Return her book \`Q2\`

## Log
- 2026-09-14 First call, she talked through the notation.
- 2026-09-18 Agreed the byte-level approach.
`,
		'Work/Kickoff.md': `# Kickoff

Met [[Ada Lovelace]] about the handbook, see [[Handbook]].

- [ ] Draft the brief for [[Ada Lovelace]] \`Q1\`
	- ask [[Grace Hopper]] about the compiler too
`
	};
}
