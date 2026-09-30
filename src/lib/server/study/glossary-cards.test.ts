import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { scanCards } from './flashcards';
import {
	cardFileHeader,
	categoryFileName,
	followGlossaryCards,
	glossaryCardsState,
	reconcileGlossaryCards,
	renamedCardFile,
	syncAllGlossaryCards,
	syncGlossaryCards,
	type CardFileText,
	type TermEntry
} from './glossary-cards';
import type { Workspace } from '../workspaces';

const FOLDER = 'Study/CS/Flashcards/Glossary/Computer Science';
const at = (name: string) => `${FOLDER}/${name}.md`;
const SR = '<!--SR:!2026-10-02,3,250!2026-10-01,1,230-->';

const term = (name: string, category: string | null, definition: string, relevance: string | null = null): TermEntry => ({ term: name, category, definition, relevance });

const VPC = term('VPC', 'Cloud', 'An isolated virtual network.', 'Where the endpoints live.');
const CDK = term('CDK', 'Cloud', 'Infrastructure as code.');
const TCP = term('TCP', 'Networking', 'A reliable transport.');

/** A file made by the reconciler: the header, then each card block, with an optional comment under it. */
function made(category: string | null, ...cards: Array<[string, string | null]>): string {
	return `${cardFileHeader('Computer Science', category)}${cards.map(([block, sr]) => `\n${block}\n${sr ? `${sr}\n` : ''}`).join('')}`;
}

/** Run the reconciler and give back every file after it, by path, and what changed. */
function run(entries: TermEntry[], files: Record<string, string>) {
	const given: CardFileText[] = Object.entries(files).map(([path, content]) => ({ path, content }));
	const result = reconcileGlossaryCards('Computer Science', FOLDER, entries, given);
	const after = { ...files };
	for (const change of result.changes) after[change.path] = change.after;
	return { ...result, after, changed: result.changes.map((c) => c.path) };
}

describe('reconcileGlossaryCards', () => {
	it.each([
		{
			what: 'a first link, making a card of every term with a definition, one file per category',
			entries: [VPC, CDK, TCP, term('Big O', null, 'A growth bound.'), term('Pending', 'Cloud', '')],
			files: {},
			want: {
				[at('Cloud')]: made('Cloud', ['VPC\n??\nAn isolated virtual network.\n→ Where the endpoints live.', null], ['CDK\n??\nInfrastructure as code.', null]),
				[at('Networking')]: made('Networking', ['TCP\n??\nA reliable transport.', null]),
				[at('Uncategorised')]: made(null, ['Big O\n??\nA growth bound.', null])
			}
		},
		{
			what: 'a new term, appended to its category’s file',
			entries: [VPC, CDK],
			files: { [at('Cloud')]: made('Cloud', ['VPC\n??\nAn isolated virtual network.\n→ Where the endpoints live.', SR]) },
			want: {
				[at('Cloud')]: made('Cloud', ['VPC\n??\nAn isolated virtual network.\n→ Where the endpoints live.', SR], ['CDK\n??\nInfrastructure as code.', null])
			}
		},
		{
			what: 'an edited definition, keeping the schedule under it',
			entries: [term('VPC', 'Cloud', 'A private network\nin the cloud.', 'Where the endpoints live.'), CDK],
			files: { [at('Cloud')]: made('Cloud', ['VPC\n??\nAn isolated virtual network.\n→ Where the endpoints live.', SR], ['CDK\n??\nInfrastructure as code.', null]) },
			want: {
				[at('Cloud')]: made('Cloud', ['VPC\n??\nA private network\nin the cloud.\n→ Where the endpoints live.', SR], ['CDK\n??\nInfrastructure as code.', null])
			}
		},
		{
			what: 'a relevance line added',
			entries: [term('CDK', 'Cloud', 'Infrastructure as code.', 'How we deploy.')],
			files: { [at('Cloud')]: made('Cloud', ['CDK\n??\nInfrastructure as code.', SR]) },
			want: { [at('Cloud')]: made('Cloud', ['CDK\n??\nInfrastructure as code.\n→ How we deploy.', SR]) }
		},
		{
			what: 'a relevance line removed',
			entries: [term('VPC', 'Cloud', 'An isolated virtual network.')],
			files: { [at('Cloud')]: made('Cloud', ['VPC\n??\nAn isolated virtual network.\n→ Where the endpoints live.', SR]) },
			want: { [at('Cloud')]: made('Cloud', ['VPC\n??\nAn isolated virtual network.', SR]) }
		},
		{
			what: 'a category change, moving the card and its schedule',
			entries: [term('VPC', 'Networking', 'An isolated virtual network.', 'Where the endpoints live.'), CDK, TCP],
			files: {
				[at('Cloud')]: made('Cloud', ['VPC\n??\nAn isolated virtual network.\n→ Where the endpoints live.', SR], ['CDK\n??\nInfrastructure as code.', null]),
				[at('Networking')]: made('Networking', ['TCP\n??\nA reliable transport.', null])
			},
			want: {
				[at('Cloud')]: made('Cloud', ['CDK\n??\nInfrastructure as code.', null]),
				[at('Networking')]: made('Networking', ['TCP\n??\nA reliable transport.', null], ['VPC\n??\nAn isolated virtual network.\n→ Where the endpoints live.', SR])
			}
		},
		{
			what: 'a category change into a file not made yet',
			entries: [term('CDK', 'DevOps', 'Infrastructure as code.')],
			files: { [at('Cloud')]: made('Cloud', ['CDK\n??\nInfrastructure as code.', SR]) },
			want: {
				[at('Cloud')]: cardFileHeader('Computer Science', 'Cloud'),
				[at('DevOps')]: made('DevOps', ['CDK\n??\nInfrastructure as code.', SR])
			}
		},
		{
			what: 'a deleted term, whose card stays',
			entries: [CDK],
			files: { [at('Cloud')]: made('Cloud', ['VPC\n??\nAn isolated virtual network.', SR], ['CDK\n??\nInfrastructure as code.', null]) },
			want: { [at('Cloud')]: made('Cloud', ['VPC\n??\nAn isolated virtual network.', SR], ['CDK\n??\nInfrastructure as code.', null]) }
		},
		{
			what: 'a renamed term, which gets a new card beside the old one',
			entries: [term('Virtual Private Cloud', 'Cloud', 'An isolated virtual network.')],
			files: { [at('Cloud')]: made('Cloud', ['VPC\n??\nAn isolated virtual network.', SR]) },
			want: { [at('Cloud')]: made('Cloud', ['VPC\n??\nAn isolated virtual network.', SR], ['Virtual Private Cloud\n??\nAn isolated virtual network.', null]) }
		},
		{
			what: 'a term matched ignoring case and spacing, its front rewritten',
			entries: [term('Big  O', null, 'A growth bound.')],
			files: { [at('Uncategorised')]: made(null, ['big o\n??\nA growth bound.', SR]) },
			want: { [at('Uncategorised')]: made(null, ['Big  O\n??\nA growth bound.', SR]) }
		},
		{
			what: 'a term and a definition needing escaping',
			entries: [term('#include', 'C', 'Pulls in a header.\n\n## Careful\n?\nIt is textual.'), term('??', 'C', 'Nullish coalescing, as in a ?? b.')],
			files: {},
			want: {
				[at('C')]: made('C', ['\\#include\n??\nPulls in a header.\n**Careful**\n\\?\nIt is textual.', null], ['\\?\\?\n??\nNullish coalescing, as in a ?? b.', null])
			}
		},
		{
			what: 'a category a file name cannot hold',
			entries: [term('Pipe', 'Unix/Shell: basics', 'Joins two programs.')],
			files: {},
			want: { [at('Unix Shell basics')]: made('Unix/Shell: basics', ['Pipe\n??\nJoins two programs.', null]) }
		},
		{
			what: 'a goal and other frontmatter the author added, and a card of their own',
			entries: [term('CDK', 'Cloud', 'Infrastructure as code, in TypeScript.')],
			files: {
				[at('Cloud')]: made('Cloud', ['CDK\n??\nInfrastructure as code.', SR], ['My own::card', null]).replace('goal:\n', 'goal: AWS exam\ntags: [mine]\n')
			},
			want: {
				[at('Cloud')]: made('Cloud', ['CDK\n??\nInfrastructure as code, in TypeScript.', SR], ['My own::card', null]).replace('goal:\n', 'goal: AWS exam\ntags: [mine]\n')
			}
		},
		{
			what: 'a category file whose name differs in case',
			entries: [term('CDK', 'cloud', 'Infrastructure as code.')],
			files: { [at('Cloud')]: made('Cloud', ['CDK\n??\nInfrastructure as code.', SR]) },
			want: { [at('Cloud')]: made('Cloud', ['CDK\n??\nInfrastructure as code.', SR]) }
		},
		{
			what: 'the second copy an interrupted move left behind',
			entries: [term('CDK', 'DevOps', 'Infrastructure as code.')],
			files: { [at('Cloud')]: made('Cloud', ['CDK\n??\nInfrastructure as code.', SR]), [at('DevOps')]: made('DevOps', ['CDK\n??\nInfrastructure as code.', SR]) },
			want: { [at('Cloud')]: cardFileHeader('Computer Science', 'Cloud'), [at('DevOps')]: made('DevOps', ['CDK\n??\nInfrastructure as code.', SR]) }
		}
	])('handles $what', ({ entries, files, want }) => {
		const first = run(entries, files);
		expect(first.problems).toEqual([]);
		expect(first.after).toEqual(want);
		for (const [path, content] of Object.entries(first.after)) {
			// Every file reads back as cards, and every term with a definition is one.
			expect(scanCards(content, path).every((c) => c.question && c.answer)).toBe(true);
		}
		// Idempotent: a second run on its own output changes nothing.
		const second = run(entries, first.after);
		expect(second.changed).toEqual([]);
	});

	it('changes nothing when every card is already in step', () => {
		const files = { [at('Cloud')]: made('Cloud', ['VPC\n??\nAn isolated virtual network.\n→ Where the endpoints live.', SR], ['CDK\n??\nInfrastructure as code.', null]) };
		expect(run([VPC, CDK], files).changed).toEqual([]);
	});

	it('keeps prosoche’s own FSRS comment as it keeps the plugin’s, through an edit and a move', () => {
		const FSRS = '<!--fsrs:2026-10-02,3.21,5.8,4,0,review,2026-09-29!new-->';
		const edited = run([term('VPC', 'Cloud', 'A private network.')], { [at('Cloud')]: made('Cloud', ['VPC\n??\nAn isolated virtual network.', FSRS]) });
		expect(edited.after[at('Cloud')]).toBe(made('Cloud', ['VPC\n??\nA private network.', FSRS]));
		const moved = run([term('VPC', 'Networking', 'A private network.')], edited.after);
		expect(moved.problems).toEqual([]);
		expect(moved.after[at('Networking')]).toBe(made('Networking', ['VPC\n??\nA private network.', FSRS]));
	});

	it('keeps a CRLF file’s line endings on the lines it rewrites', () => {
		const file = made('Cloud', ['CDK\n??\nInfrastructure as code.', SR]).replace(/\n/g, '\r\n');
		const { after } = run([term('CDK', 'Cloud', 'Infra as code.')], { [at('Cloud')]: file });
		expect(after[at('Cloud')]).toBe(file.replace('Infrastructure as code.', 'Infra as code.'));
	});

	it('stages a moving card in both files before cutting it from either', () => {
		const files = {
			[at('Cloud')]: made('Cloud', ['VPC\n??\nAn isolated virtual network.', SR]),
			[at('Networking')]: made('Networking', ['TCP\n??\nA reliable transport.', '<!--SR:!2026-10-09,9,250-->'])
		};
		// VPC to Networking and TCP to Cloud at once: a swap.
		const result = reconcileGlossaryCards('Computer Science', FOLDER, [term('VPC', 'Networking', 'An isolated virtual network.'), term('TCP', 'Cloud', 'A reliable transport.')], [
			{ path: at('Cloud'), content: files[at('Cloud')] },
			{ path: at('Networking'), content: files[at('Networking')] }
		]);
		for (const change of result.changes) {
			const staged = scanCards(change.staged, change.path).map((c) => c.question);
			expect(staged).toEqual(expect.arrayContaining(['VPC', 'TCP']));
			expect(scanCards(change.after, change.path)).toHaveLength(1);
		}
	});

	it('leaves a file alone that would not read back, with the terms bound for it, and says so', () => {
		// An unclosed fence in the author's file would swallow every card appended after it.
		const broken = `${made('Cloud', ['CDK\n??\nInfrastructure as code.', SR])}\n\`\`\`\nunclosed\n`;
		const result = run([term('CDK', 'Cloud', 'Infra as code.'), term('VPC', 'Cloud', 'A network.'), TCP], { [at('Cloud')]: broken });
		expect(result.after[at('Cloud')]).toBe(broken);
		expect(result.changed).toEqual([at('Networking')]);
		expect(result.problems).toEqual([`${at('Cloud')} would not read back as the glossary’s cards, so it was left as it is.`]);
	});

	it('never touches a file it has nothing to do with', () => {
		const other = 'Just notes, with a VPC::mention\n';
		const { changed } = run([VPC], { [at('Notes')]: other });
		expect(changed).toEqual([at('Cloud')]);
	});

	it('counts the terms that have a card', () => {
		expect(run([VPC, CDK, term('Pending', null, '')], {}).cards).toBe(2);
	});
});

describe('categoryFileName and cardFileHeader', () => {
	it.each([
		['Cloud', 'Cloud'],
		[null, 'Uncategorised'],
		['  ', 'Uncategorised'],
		['C/C++', 'C C++'],
		['[[Links]]', 'Links'],
		['...', 'Uncategorised']
	])('names the file for %s %s', (category, name) => {
		expect(categoryFileName(category)).toBe(name);
	});

	it('writes the header of the spec, holding no card', () => {
		expect(cardFileHeader('Computer Science', 'Cloud')).toBe(
			'---\ngoal:\nglossary: Computer Science\ncategory: Cloud\n---\n\n#flashcards\n\nMade from [[Glossaries/Computer Science|Computer Science]] (Cloud). Edit the terms there; this file is\nkept in step with the glossary.\n'
		);
		expect(cardFileHeader('eye2gene', null)).toContain('category:\n---');
		expect(scanCards(cardFileHeader('Computer Science', 'Cloud'), 'x.md')).toEqual([]);
	});
});

describe('renamedCardFile', () => {
	it('upgrades a bare Made from link, from before links went by path, to one by path', () => {
		const before = '---\ngoal:\nglossary: Computer Science\ncategory: Cloud\n---\n\n#flashcards\n\nMade from [[Computer Science]] (Cloud). Edit the terms there.\n';
		expect(renamedCardFile(before, 'Computer Science', 'CS Terms')).toBe(
			before.replace('glossary: Computer Science', 'glossary: CS Terms').replace('[[Computer Science]]', '[[Glossaries/CS Terms|CS Terms]]')
		);
	});

	it('names the new glossary in the frontmatter and the Made from line, and nothing else', () => {
		const before = made('Cloud', ['VPC\n??\nMade from [[Computer Science]] is not the header here.', SR]).replace('goal:\n', 'goal: AWS\n');
		const after = renamedCardFile(before, 'Computer Science', 'CS Terms');
		expect(after).toBe(before.replace('glossary: Computer Science', 'glossary: CS Terms').replace('Made from [[Glossaries/Computer Science|Computer Science]] (Cloud)', 'Made from [[Glossaries/CS Terms|CS Terms]] (Cloud)'));
	});
});

describe('syncing a glossary’s cards', () => {
	let root: string;
	let vault: Vault;
	const cs: Workspace = { slug: 'cs', name: 'CS study', color: '#000', tag: 'ws/cs', aliases: [], folders: ['Study/CS'], template: 'study', path: '_hub/workspaces/cs.md' };
	const GLOSSARY = 'Glossaries/Computer Science.md';
	const entry = (name: string, category: string, definition: string) => `## ${name}\n- status:: looked-up\n- category:: ${category}\n\n${definition}\n\n`;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-glossary-cards-'));
		vault = new Vault(root);
		await vault.write(GLOSSARY, `---\nstudy: cs\n---\n# Glossary\n\n${entry('VPC', 'Cloud', 'A network.')}${entry('TCP', 'Networking', 'A transport.')}`);
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('writes one file per category, then nothing the second time', async () => {
		const first = await syncGlossaryCards(vault, [cs], GLOSSARY);
		expect(first).toMatchObject({ state: 'linked', cards: 2, written: [at('Cloud'), at('Networking')], conflict: null });
		const cloud = (await vault.read(at('Cloud'))).content;
		expect(cloud).toBe(made('Cloud', ['VPC\n??\nA network.', null]));
		const second = await syncGlossaryCards(vault, [cs], GLOSSARY);
		expect(second).toMatchObject({ written: [], pending: 0 });
		expect(await glossaryCardsState(vault, [cs], GLOSSARY)).toMatchObject({ state: 'linked', subject: { slug: 'cs', name: 'CS study' }, cards: 2, pending: 0 });
	});

	it('keeps a schedule written in by hand when the definition changes', async () => {
		await syncGlossaryCards(vault, [cs], GLOSSARY);
		const cloud = (await vault.read(at('Cloud'))).content;
		await vault.write(at('Cloud'), cloud.replace('A network.\n', `A network.\n${SR}\n`));
		const glossary = (await vault.read(GLOSSARY)).content;
		await vault.write(GLOSSARY, glossary.replace('A network.', 'A private network.'));
		await syncGlossaryCards(vault, [cs], GLOSSARY);
		expect((await vault.read(at('Cloud'))).content).toBe(made('Cloud', ['VPC\n??\nA private network.', SR]));
	});

	it('does nothing for a glossary with no subject, or an unknown one', async () => {
		const glossary = (await vault.read(GLOSSARY)).content;
		await vault.write(GLOSSARY, glossary.replace('study: cs', 'study: nope'));
		expect(await syncGlossaryCards(vault, [cs], GLOSSARY)).toEqual({ state: 'unknown', study: 'nope' });
		await vault.write(GLOSSARY, glossary.replace('study: cs', 'study:'));
		expect(await syncGlossaryCards(vault, [cs], GLOSSARY)).toEqual({ state: 'unlinked' });
		expect(await vault.files(FOLDER, 'md')).toEqual([]);
	});

	it('stops at a clash rather than overwrite a card file edited meanwhile', async () => {
		await syncGlossaryCards(vault, [cs], GLOSSARY);
		const glossary = (await vault.read(GLOSSARY)).content;
		await vault.write(GLOSSARY, glossary.replace('A network.', 'A private network.'));
		// Someone edits the card file between the sync's read and its write.
		const write = vault.write.bind(vault);
		let once = true;
		vault.write = async (path, content, hash, opts) => {
			if (once && path === at('Cloud')) {
				once = false;
				await write(path, `${(await vault.read(path)).content}\nMine::too\n`);
			}
			return write(path, content, hash, opts);
		};
		const result = await syncGlossaryCards(vault, [cs], GLOSSARY);
		expect(result).toMatchObject({ conflict: at('Cloud') });
		expect((await vault.read(at('Cloud'))).content).toContain('Mine::too');
		vault.write = write;
		expect(await syncGlossaryCards(vault, [cs], GLOSSARY)).toMatchObject({ written: [at('Cloud')], conflict: null });
		expect((await vault.read(at('Cloud'))).content).toContain('A private network.');
	});

	it('moves the cards to the new name’s folder when the glossary is renamed', async () => {
		await syncGlossaryCards(vault, [cs], GLOSSARY);
		const content = (await vault.read(GLOSSARY)).content;
		await vault.write('Glossaries/CS Terms.md', content);
		await vault.remove(GLOSSARY);
		const result = await syncGlossaryCards(vault, [cs], 'Glossaries/CS Terms.md', { renamedFrom: 'Computer Science' });
		expect(result).toMatchObject({ written: [], cards: 2 });
		expect(await vault.files(FOLDER, 'md')).toEqual([]);
		expect((await vault.read('Study/CS/Flashcards/Glossary/CS Terms/Cloud.md')).content).toContain('Made from [[Glossaries/CS Terms|CS Terms]] (Cloud)');
	});

	it('syncs every linked glossary at start, and a changed one when it changes', async () => {
		await vault.write('Glossaries/Other.md', `# Glossary\n\n${entry('Hue', 'Art', 'A colour.')}`);
		const all = await syncAllGlossaryCards(vault, [cs]);
		expect(all.map((r) => r.state)).toEqual(['linked', 'unlinked']);

		const stop = followGlossaryCards(vault, async () => [cs], 10);
		const glossary = (await vault.read(GLOSSARY)).content;
		await vault.write(GLOSSARY, `${glossary}${entry('DNS', 'Networking', 'Names to addresses.')}`);
		await new Promise((r) => setTimeout(r, 100));
		await syncGlossaryCards(vault, [cs], GLOSSARY); // waits for the one the change started
		stop();
		expect((await vault.read(at('Networking'))).content).toContain('DNS\n??\nNames to addresses.');
	});
});
