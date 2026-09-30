/**
 * The glossary `Glossaries/Work.md` for the Glossary suite, one entry looked
 * up and one waiting. The Work workspace names it (`glossary: Work`) in its
 * workspace file, in `make-vault.mjs`; Study names no glossary.
 */

/** The day before `day`, as `YYYY-MM-DD`. Mirrored in `e2e/glossary.spec.ts`. */
function pastDay(day) {
	const [y, m, d] = day.split('-').map(Number);
	const date = new Date(y, m - 1, d - 1);
	const pad = (n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default ({ TODAY }) => ({
	'Glossaries/Work.md': `# Glossary

## DVC
- guess:: Data version control
- status:: looked-up
- category:: ML
- source:: [[${pastDay(TODAY)} Dev Weekly]]
- drafted:: Claude

An open-source tool that versions datasets and models alongside git.

→ For Work, it makes training data traceable.

## MLflow
- status:: to-look-up
- category:: Tooling
`
});
