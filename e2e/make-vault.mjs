/**
 * Builds a disposable vault for the end-to-end tests, then a bare remote for
 * it so commit and push are exercised for real.
 *
 * The content mirrors the conventions the app was written against: a daily
 * note copied from a template, times as `HH:MM - HH:MM`, the priority tag as
 * inline code, a Backlog inside a code fence, and reference notes that use
 * `- [ ]` as checklist notation rather than as tasks.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const VAULT = process.env.E2E_VAULT ?? '/tmp/prosoche-e2e/vault';
const REMOTE = process.env.E2E_REMOTE ?? '/tmp/prosoche-e2e/remote.git';

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
export const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const [y, m, d] = TODAY.split('-');

const TEMPLATE = `# [[Journal ${now.getFullYear()}]]
***EXECUTE*** - *Time-block your planning*

# Tasks
- [ ] Morning stretch \`Q1\`
- [ ] Write the daily log \`Q1\`
	- What am I avoiding, and why
- [ ] Walk the dog, refill the water \`Q1\`
- [ ] Twenty push ups
## Backlog
\`\`\`
- [ ] Driving licence \`Q2\`
- [ ] Learn the thing \`Q2\`
\`\`\`
`;

const TODAY_NOTE = `# [[Journal ${now.getFullYear()}]]
***EXECUTE*** - *Time-block your planning*

# Tasks
- [x] 09:30 - 10:00 Morning stretch \`Q1\`
- [ ] 23:00 - 23:10 Write the daily log \`Q1\`
	- What am I avoiding, and why
- [ ] Walk the dog, refill the water \`Q1\`
- [ ] Twenty push ups
- [ ] 10:40 - 18:00 Client project
- [ ] 14:00 - 14:30 Read a book \`Q2\`
## Backlog
\`\`\`
- [ ] Driving licence \`Q2\`
- [ ] Learn the thing \`Q2\`
\`\`\`
`;

const files = {
	'Journal/Journal Template.md': TEMPLATE,
	[`Journal/${y}/${m}/${d}.md`]: TODAY_NOTE,
	'Study/Algorithms.md': `# Algorithms\n\nSee [[Handbook]] and [[Nowhere At All]].\n\n#study\n\n- [ ] Finish chapter 3 \`Q2\`\n`,
	'Study/Syllabus.md': `# Syllabus\n\nChecklist notation, not tasks:\n\n- [ ] **Indexing:** sharding\n- [ ] \`btree\` versus \`hash\`\n`,
	'Work/Handbook.md': `---\ntype: reference\norg: Acme\n---\n\n# Handbook\n\nTwos complement and the adder.\n`,
	'Inbox/README.md': `# Inbox\n\nUnsorted capture.\n`,
	// Committed, so the fixture looks like a vault that has already been used
	// once and the working tree starts genuinely clean. Seeding itself is
	// covered by a unit test.
	'_hub/workspaces/study.md': `---\nname: Study\ncolor: "#7c3aed"\ntag: ws/study\ntemplate: study\nfolders:\n  - "Study"\ntabs:\n  - title: Board\n    widgets: [board]\n---\n\nCourses and reading.\n`,
	'_hub/workspaces/work.md': `---\nname: Work\ncolor: "#2f6fed"\ntag: ws/work\ntemplate: project\nfolders:\n  - "Work"\ntabs:\n  - title: Board\n    widgets: [board]\n---\n\nThe day job.\n`
};

/**
 * Each phase adds its own fixtures in its own file under `fixtures/`, exporting
 * a default function that returns `{ path: content }`. One shared file being
 * appended to by several people is how fixtures end up contradicting each
 * other; a file each keeps them separable and lets a phase's data be read on
 * its own.
 */
const extras = existsSync(join(import.meta.dirname, 'fixtures'))
	? readdirSync(join(import.meta.dirname, 'fixtures')).filter((f) => f.endsWith('.mjs')).sort()
	: [];
for (const name of extras) {
	const module = await import(pathToFileURL(join(import.meta.dirname, 'fixtures', name)).href);
	Object.assign(files, await module.default({ TODAY, year: now.getFullYear() }));
}

rmSync(dirname(VAULT), { recursive: true, force: true });
for (const [path, content] of Object.entries(files)) {
	const full = join(VAULT, path);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, content);
}

const git = (...args) => execFileSync('git', ['-C', VAULT, ...args], { stdio: 'pipe' });
execFileSync('git', ['init', '-q', '--bare', REMOTE]);
execFileSync('git', ['init', '-q', '-b', 'master', VAULT]);
git('config', 'user.name', 'e2e');
git('config', 'user.email', 'e2e@test');
git('remote', 'add', 'origin', REMOTE);
git('add', '-A');
git('commit', '-q', '-m', 'fixture');
git('tag', '-f', 'fixture-baseline');
git('push', '-q', '-u', 'origin', 'master');

console.log(`fixture vault at ${VAULT}, remote ${REMOTE}, today ${TODAY}`);
