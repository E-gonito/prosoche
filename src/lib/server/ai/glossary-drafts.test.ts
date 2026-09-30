import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { apply, policyFor, validate } from './proposal';
import { draftLookups, lookupPrompt, lookupProposal } from './glossary-drafts';
import { parseGlossary } from '../parse/glossary';
import type { GlossaryRef } from '../glossary';
import type { Workspace } from '../workspaces';
import type { FeatureId, RunStamp } from '$lib/shared/ai';

const stamp = (feature: FeatureId): RunStamp => ({
	model: 'claude-sonnet-5',
	effort: 'medium',
	permission: 'propose',
	budgetUsd: 0.25,
	timeoutSeconds: 120,
	feature,
	startedAt: '2026-09-29T09:00:00.000Z',
	durationMs: 1000,
	costUsd: 0.01
});

const WORK: Workspace = {
	slug: 'work',
	name: 'Eye2Gene',
	color: '#000',
	tag: 'ws/work',
	aliases: [],
	folders: ['Work'],
	template: 'project',
	glossary: 'eye2gene',
	path: '_hub/workspaces/work.md'
};

const PATH = 'Glossaries/eye2gene.md';
const REF: GlossaryRef = { name: 'eye2gene', slug: 'eye2gene', path: PATH, linked: [WORK], color: '#000' };
const LONE: GlossaryRef = { name: 'Computer Science', slug: 'computer-science', path: 'Glossaries/Computer Science.md', linked: [], color: '#6b7280' };

const SETTINGS = { enabled: true, blast: { maxFiles: 5, maxLineLoss: 0.3 } };
const policy = (feature: FeatureId, destinations: string[]) => policyFor(feature, SETTINGS, { today: '2026-09-29', destinations });

const GLOSSARY = `# Glossary

## DVC
- guess:: data versioning
- status:: looked-up
- category:: ML

Tracks data.

→ For eye2gene, traceability.

## Cookie Cutter
- guess:: something for AI models
- status:: to-look-up
- source:: [[2026-09-28 Dev Weekly]]

## MLflow
- status:: to-look-up
`;

describe('look-ups', () => {
	it('lists each pending term with its guess and asks why it matters to the glossary', () => {
		const entries = parseGlossary(GLOSSARY).filter((e) => e.pending);
		const prompt = lookupPrompt({ glossary: 'eye2gene', entries, sources: [] });
		expect(prompt).toContain('"eye2gene" glossary');
		expect(prompt).toContain('- Cookie Cutter (their guess: something for AI models)');
		expect(prompt).toContain('- MLflow\n');
		expect(prompt).not.toContain('- DVC');
		expect(prompt).toContain('beginning "For eye2gene,"');
	});

	it('fills in pending entries and marks them looked up', () => {
		const p = lookupProposal(
			PATH,
			{ content: GLOSSARY, hash: 'g' },
			[
				{ term: 'cookie cutter', definition: 'A project template tool.', relevance: 'For eye2gene, it scaffolds ML projects.' },
				{ term: 'DVC', definition: 'Should be ignored, already looked up.', relevance: '' },
				{ term: 'Unknown', definition: 'Not asked for.', relevance: '' }
			],
			stamp('glossary-lookup')
		)!;
		expect(p.edits).toHaveLength(1);
		const edit = p.edits[0];
		expect(edit).toMatchObject({ kind: 'revise', path: PATH, expectedHash: 'g' });
		const entries = parseGlossary('text' in edit ? edit.text : '');
		expect(entries[0].definition).toBe('Tracks data.');
		expect(entries[1]).toMatchObject({ status: 'looked-up', definition: 'A project template tool.', relevance: 'For eye2gene, it scaffolds ML projects.', pending: false });
		expect(entries[1].fields.drafted.value).toBe('Claude');
		expect(entries[2].pending).toBe(true);
		expect(p.summary).toBe('Definitions for 1 term in eye2gene.');
	});

	it('proposes nothing when no answer matches a pending entry', () => {
		expect(lookupProposal(PATH, { content: GLOSSARY, hash: 'g' }, [{ term: 'DVC', definition: 'x', relevance: '' }], stamp('glossary-lookup'))).toBeNull();
	});
});

describe('the glossary path policy', () => {
	it.each<[string[], string, boolean]>([
		[[PATH], PATH, true],
		[['Glossaries/Computer Science.md'], 'Glossaries/Computer Science.md', true],
		[[PATH], 'Glossaries/other.md', false],
		[['Work/Glossary.md'], 'Work/Glossary.md', false],
		[['Glossaries/Sub/x.md'], 'Glossaries/Sub/x.md', false],
		[['Work/Primer.md'], 'Work/Primer.md', false],
		[['_hub/ai.md'], '_hub/ai.md', false]
	])('with %j may write %s: %s', (destinations, path, allowed) => {
		const p = policy('glossary-lookup', destinations);
		expect(p.path.allow.some((a) => a === path)).toBe(allowed);
		expect(p.blast.maxFiles).toBe(1);
	});
});

describe('on disk', () => {
	let dir: string;
	let undo: string;
	let scratch: string;
	let vault: Vault;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'glossary-drafts-'));
		undo = await mkdtemp(join(tmpdir(), 'glossary-undo-'));
		scratch = await mkdtemp(join(tmpdir(), 'glossary-cli-'));
		vault = new Vault(dir);
		await vault.write('_hub/ai.md', '---\nenabled: true\n---\n');
		await vault.write(WORK.path, '---\nname: Eye2Gene\nglossary: eye2gene\nfolders: [Work]\n---\n');
	});
	afterEach(async () => {
		for (const d of [dir, undo, scratch]) await rm(d, { recursive: true, force: true });
	});

	async function fakeCli(result: unknown): Promise<string> {
		const path = join(scratch, 'fake-claude');
		const body = JSON.stringify({ type: 'result', subtype: 'success', result: JSON.stringify(result), total_cost_usd: 0.01 });
		await writeFile(path, `#!/bin/sh\ncat <<'JSON'\n${body}\nJSON\n`, 'utf8');
		await chmod(path, 0o755);
		return path;
	}

	it('writes a look-up only after accept, and refuses one whose glossary changed since', async () => {
		await vault.write(PATH, GLOSSARY);
		const note = await vault.read(PATH);
		const proposal = lookupProposal(PATH, note, [{ term: 'MLflow', definition: 'ML lifecycle.', relevance: 'For eye2gene, versions.' }], stamp('glossary-lookup'))!;
		const pol = policy('glossary-lookup', [PATH]);
		expect((await validate(vault, proposal, pol)).ok).toBe(true);
		expect((await apply(vault, proposal, pol, { accepted: [], vaultPath: dir, undoPath: undo })).written).toEqual([]);
		expect((await vault.read(PATH)).content).toBe(GLOSSARY);

		await vault.write(PATH, `${GLOSSARY}\n## Added in Obsidian\n`);
		const checked = await validate(vault, proposal, pol);
		expect(checked.ok).toBe(false);
		expect(checked.previews[0].refusals[0].guardrail).toBe('G6');
	});

	it('looks up only pending terms, for a linked glossary or a lone one, writing nothing', async () => {
		await vault.write(PATH, GLOSSARY);
		const executable = await fakeCli({
			entries: [
				{ term: 'Cookie Cutter', definition: 'Templates.', relevance: 'For eye2gene, scaffolding.' },
				{ term: 'MLflow', definition: 'Lifecycle.', relevance: 'For eye2gene, versions.' }
			]
		});
		const result = await draftLookups(vault, REF, null, { cli: { executable, vaultPath: dir } });
		expect(result.destinations).toEqual([PATH]);
		expect(result.proposal?.summary).toBe('Definitions for 2 terms in eye2gene.');
		expect((await vault.read(PATH)).content).toBe(GLOSSARY);

		await vault.write(LONE.path, GLOSSARY);
		const lone = await draftLookups(vault, LONE, ['MLflow'], { cli: { executable, vaultPath: dir } });
		expect(lone.proposal?.edits[0]).toMatchObject({ path: LONE.path });
		expect((await draftLookups(vault, REF, ['DVC'])).problem).toBe('Nothing is waiting to be looked up.');
	});

	it('says why a look-up cannot run: the kill switch', async () => {
		await vault.write(PATH, GLOSSARY);
		await vault.write('_hub/ai.md', '---\nenabled: false\n---\n');
		const off = await draftLookups(vault, REF, null);
		expect(off.proposal).toBeNull();
		expect(off.refusals[0].guardrail).toBe('G10');
		expect(off.problem).toBeTruthy();
	});
});
