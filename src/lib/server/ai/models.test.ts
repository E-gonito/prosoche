import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SHIPPED_MODELS } from '$lib/shared/ai';
import { availableModels, parseCatalog } from './models';

const catalog = (models: unknown[]) => ({ version: 2, catalog: { surface: 'cc', config: { id: 'cc', models } } });

describe('parseCatalog', () => {
	it('puts the main models first, then the older ones, each in file order', () => {
		const out = parseCatalog(
			catalog([
				{ id: 'claude-opus-5', name: 'Opus 5', section: 'overflow' },
				{ id: 'claude-opus-6', name: 'Opus 6', section: 'main', description: 'For complex work' },
				{ id: 'claude-sonnet-6', name: 'Sonnet 6', section: 'main' }
			])
		);
		expect(out).toEqual([
			{ id: 'claude-opus-6', label: 'Opus 6', hint: 'For complex work' },
			{ id: 'claude-sonnet-6', label: 'Sonnet 6', hint: '' },
			{ id: 'claude-opus-5', label: 'Opus 5', hint: 'An older model.' }
		]);
	});

	it('skips an entry without a usable id or name, and a repeat', () => {
		const out = parseCatalog(
			catalog([
				{ id: 'claude-sonnet-6', name: 'Sonnet 6', section: 'main' },
				{ id: 'claude-sonnet-6', name: 'Again', section: 'main' },
				{ id: '--dangerously-skip-permissions', name: 'Nope', section: 'main' },
				{ id: 'gpt-9', name: 'Nope', section: 'main' },
				{ id: 'claude-x' },
				'not an entry'
			])
		);
		expect(out.map((m) => m.id)).toEqual(['claude-sonnet-6']);
	});

	it.each([null, 'text', [], {}, { catalog: { config: { models: 'many' } } }])('reads %j as no models', (json) => {
		expect(parseCatalog(json)).toEqual([]);
	});
});

describe('availableModels', () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'model-catalog-'));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('offers the newest catalog, then any shipped model it leaves out', async () => {
		await writeFile(join(dir, 'old.json'), JSON.stringify(catalog([{ id: 'claude-old-1', name: 'Old', section: 'main' }])));
		await utimes(join(dir, 'old.json'), new Date('2026-01-01'), new Date('2026-01-01'));
		await writeFile(
			join(dir, 'new.json'),
			JSON.stringify(catalog([{ id: 'claude-sonnet-6', name: 'Sonnet 6', section: 'main' }, { id: 'claude-opus-5-5', name: 'Opus 5.5', section: 'overflow' }]))
		);
		const ids = (await availableModels(dir)).map((m) => m.id);
		expect(ids.slice(0, 2)).toEqual(['claude-sonnet-6', 'claude-opus-5-5']);
		expect(ids).not.toContain('claude-old-1');
		expect(ids.slice(2)).toEqual(SHIPPED_MODELS.map((m) => m.id).filter((id) => id !== 'claude-opus-5-5'));
	});

	it('falls back to the shipped list when there is no catalog or it is not JSON', async () => {
		expect(await availableModels(join(dir, 'missing'))).toEqual(SHIPPED_MODELS);
		await writeFile(join(dir, 'broken.json'), '{ half');
		expect(await availableModels(dir)).toEqual(SHIPPED_MODELS);
	});
});
