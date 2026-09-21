import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoteIndex } from '../index/index';
import { Vault } from '../vault/index';
import type { Workspace } from '../workspaces';
import { keyTerms, namedNotes, retrieve, scopeFilter, trimToRelevant } from './retrieval';

const workspace = (slug: string, folders: string[]): Workspace => ({
	slug,
	name: slug,
	color: '#000',
	tag: `ws/${slug}`,
	folders,
	template: 'project',
	tabs: [],
	deck: `${folders[0]}/Tasks.md`,
	kanbanColumns: [],
	path: `_hub/workspaces/${slug}.md`
});

const WORKSPACES = [workspace('work', ['Work']), workspace('study', ['Study'])];

const NOTES: Record<string, string> = {
	'Work/Deployment.md': [
		'# Deployment',
		'',
		'## Staging',
		'Push to staging with the deploy script.',
		'',
		'## Production',
		'Production deploys need a second reviewer and a rollback plan.'
	].join('\n'),
	'Work/Meeting.md': '# Meeting\n\nWe talked about the rollback plan with [[Deployment]].',
	'Study/Algorithms.md': '# Algorithms\n\nDijkstra, and a note about the rollback of a transaction.',
	'Inbox/Capture.md': '# Capture\n\n- deployment thoughts'
};

let root: string;
let vault: Vault;
let index: NoteIndex;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-ai-retr-'));
	vault = new Vault(root);
	index = new NoteIndex(':memory:');
	for (const [path, content] of Object.entries(NOTES)) {
		await vault.write(path, content);
		index.put(path, content);
	}
});
afterEach(async () => {
	index.close();
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

const deps = () => ({ index, vault, workspaces: WORKSPACES });

describe('scopeFilter', () => {
	it('lets everything through for the whole vault', () => {
		expect(scopeFilter({ kind: 'vault' }, WORKSPACES)('anything.md')).toBe(true);
	});

	it('keeps a folder scope to that folder', () => {
		const within = scopeFilter({ kind: 'folder', path: 'Work' }, WORKSPACES);
		expect(within('Work/Deployment.md')).toBe(true);
		expect(within('Workshop/other.md')).toBe(false);
		expect(within('Study/Algorithms.md')).toBe(false);
	});

	it('keeps a workspace scope to its folders', () => {
		const within = scopeFilter({ kind: 'workspace', slug: 'work' }, WORKSPACES);
		expect(within('Work/Deployment.md')).toBe(true);
		expect(within('Study/Algorithms.md')).toBe(false);
	});

	it('matches nothing for a workspace that no longer exists', () => {
		expect(scopeFilter({ kind: 'workspace', slug: 'gone' }, WORKSPACES)('Work/a.md')).toBe(false);
	});

	it('keeps a note scope to that one note', () => {
		const within = scopeFilter({ kind: 'note', path: 'Work/Deployment.md' }, WORKSPACES);
		expect(within('Work/Deployment.md')).toBe(true);
		expect(within('Work/Meeting.md')).toBe(false);
	});
});

describe('retrieve', () => {
	it('finds the notes that mention the question, with their paths', async () => {
		const found = await retrieve(deps(), { question: 'rollback plan', scope: { kind: 'vault' } });
		expect(found.passages.length).toBeGreaterThan(0);
		expect(found.citations.map((c) => c.path)).toContain('Work/Meeting.md');
	});

	it('never crosses the scope it was given', async () => {
		const found = await retrieve(deps(), { question: 'rollback', scope: { kind: 'workspace', slug: 'work' } });
		expect(found.passages.every((p) => p.path.startsWith('Work/'))).toBe(true);
	});

	it('answers about one note from that note alone', async () => {
		const found = await retrieve(deps(), {
			question: 'what does this say',
			scope: { kind: 'note', path: 'Work/Meeting.md' }
		});
		expect(found.passages.map((p) => p.path)).toEqual(['Work/Meeting.md']);
	});

	it('pulls in a note the question names by wiki-link, even in a narrow scope', async () => {
		const found = await retrieve(deps(), {
			question: 'summarise [[Deployment]]',
			scope: { kind: 'folder', path: 'Work' }
		});
		expect(found.citations.map((c) => c.path)).toContain('Work/Deployment.md');
	});

	it('stops at the token budget and says so', async () => {
		const found = await retrieve(deps(), { question: 'rollback plan deployment', scope: { kind: 'vault' }, tokenBudget: 5 });
		expect(found.tokens).toBeLessThanOrEqual(5);
		expect(found.truncated).toBe(true);
	});

	it('returns nothing, rather than everything, when nothing matches', async () => {
		const found = await retrieve(deps(), { question: 'zzzznothinghere', scope: { kind: 'vault' } });
		expect(found.passages).toEqual([]);
		expect(found.citations).toEqual([]);
	});
});

describe('trimToRelevant', () => {
	const LONG = [
		'Opening paragraph about nothing in particular.',
		'',
		'## Deployment',
		'The deployment story, at length. '.repeat(20),
		'',
		'## Holidays',
		'Somewhere sunny, at length. '.repeat(20)
	].join('\n');

	it('returns a short note whole and unaltered', () => {
		const sections = trimToRelevant('# Short\n\nJust a line.', ['line'], 1000);
		expect(sections).toEqual([{ heading: null, text: '# Short\n\nJust a line.' }]);
	});

	it('keeps the section that mentions the terms and drops the one that does not', () => {
		const sections = trimToRelevant(LONG, ['deployment'], 800);
		const text = sections.map((s) => s.text).join('\n');
		expect(text).toContain('deployment story');
		expect(text).not.toContain('Somewhere sunny');
	});

	it('keeps each section under its heading, so the model knows what it is reading', () => {
		const sections = trimToRelevant(LONG, ['deployment'], 800);
		expect(sections[0].heading).toBe('## Deployment');
		expect(sections[0].text.startsWith('## Deployment')).toBe(true);
	});

	it('never returns more than the budget', () => {
		const sections = trimToRelevant(LONG, ['deployment', 'holidays'], 300);
		expect(sections.map((s) => s.text).join('').length).toBeLessThanOrEqual(300);
	});

	it('falls back to the opening when nothing matches, rather than to nothing', () => {
		const sections = trimToRelevant(LONG, ['unrelated'], 200);
		expect(sections).toHaveLength(1);
		expect(sections[0].text).toContain('Opening paragraph');
	});

	it('returns nothing for an empty note', () => {
		expect(trimToRelevant('   \n\n', ['x'], 100)).toEqual([]);
	});
});

describe('keyTerms', () => {
	it('drops the words that match everything', () => {
		expect(keyTerms('What did I say about the deployment?')).toEqual(['say', 'deployment']);
	});

	it('reads the name out of a wiki-link', () => {
		expect(keyTerms('summarise [[Deployment Plan]]')).toContain('deployment');
	});

	it('does not repeat a term', () => {
		expect(keyTerms('deployment deployment deployment')).toEqual(['deployment']);
	});
});

describe('namedNotes', () => {
	it('finds every wiki-link, with its alias and heading stripped', () => {
		expect(namedNotes('compare [[A Note#Section|the note]] with [[Other]]')).toEqual(['A Note', 'Other']);
	});

	it('is empty for a plain question', () => {
		expect(namedNotes('what is on today?')).toEqual([]);
	});
});
