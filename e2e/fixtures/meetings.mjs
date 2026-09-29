/**
 * The Work notebook for the Meetings and Glossary suites: a primer, a
 * glossary with one entry looked up and one waiting, and a past meeting with
 * an open action and a term the glossary does not have yet. Work opts in to
 * meetings in its workspace file, in `make-vault.mjs`.
 */

/** The day before `day`, as `YYYY-MM-DD`. Mirrored in `e2e/meetings.spec.ts`. */
export function pastDay(day) {
	const [y, m, d] = day.split('-').map(Number);
	const date = new Date(y, m - 1, d - 1);
	const pad = (n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default ({ TODAY }) => {
	const past = pastDay(TODAY);
	return {
		'Work/Primer.md': `# Work primer

**Your job in the room is to turn talk into constraints.** Notice where a constraint has no owner.

> **Rate limit:** two or three substantive interventions. Silence is not a failure state.

## Your product, in numbers

From the paper everyone quotes.

- Three input modalities: FAF, IR, SD-OCT.
  - Colour fundus photography is not a primary input.
- Ensemble of 15 CNNs.
  - Not one model, which matters for versioning.

## Four frames

1. **Clinical statement to invariant**
   Domain talk encodes constraints.
2. **Visible or silent failure**
   Silent wrongness is the expensive category.
`,
		'Work/Glossary.md': `# Glossary

## DVC
- guess:: Data version control
- status:: looked-up
- category:: ML
- source:: [[${past} Dev Weekly]]
- drafted:: Claude

An open-source tool that versions datasets and models alongside git.

→ For Work, it makes training data traceable.

## MLflow
- status:: to-look-up
- category:: Tooling
`,
		[`Work/Meetings/${past} Dev Weekly.md`]: `---
type: meeting
date: ${past}
attendees: [Ana, Ben]
ended: 11:00
---
# Dev Weekly

## Captured
- term:: Cookie Cutter guess:: something for AI models
- question:: Is the ensemble versioned as one artifact?
- decision:: Deploy to ECS, not Beanstalk
- [ ] action:: Clarify scope with the manager
- [x] action:: Book the demo room
- term:: DVC guess:: data versioning
`
	};
};
