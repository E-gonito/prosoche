/**
 * Which models the AI settings offer: the ones Claude Code itself offers.
 *
 * The CLI keeps its model list in a cache it refreshes on its own
 * (`~/.claude/cache/model-catalog/*.json`), so reading that file is how a
 * model released next month appears in the picker without a change here.
 * The shipped list in `$lib/shared/ai` is the floor: its models are always
 * offered too, so a catalog that drops an old model never invalidates a
 * setting that names it, and a machine with no catalog still has a picker.
 *
 * Read-only, and outside the vault like the undo snapshots: nothing here
 * writes, and the catalog is never copied into the vault.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config';
import { SHIPPED_MODELS, type ModelOption } from '$lib/shared/ai';

/** An id the CLI's `--model` will take; anything else in the catalog is skipped. */
const MODEL_ID = /^claude-[a-z0-9][a-z0-9.-]*$/;

/**
 * The models on offer: the newest catalog's, in its order (its main models
 * first, then the older ones), followed by any shipped model it leaves out.
 *
 * Inputs: the catalog folder, defaulting to `config.claudeCatalogPath`.
 * Side effects: reads that folder. Never throws and never returns an empty
 * list: a missing folder or a file that is not a catalog gives the shipped
 * list alone.
 */
export async function availableModels(dir: string = config.claudeCatalogPath): Promise<ModelOption[]> {
	const fromCatalog = parseCatalog(await newestCatalog(dir));
	const known = new Set(fromCatalog.map((m) => m.id));
	return [...fromCatalog, ...SHIPPED_MODELS.filter((m) => !known.has(m.id))];
}

/**
 * The models in one catalog file's parsed JSON: those in the `main` section
 * first, then the rest, each section in file order. An entry without a
 * usable id and name is skipped. Pure; anything that is not a catalog gives
 * `[]`.
 */
export function parseCatalog(json: unknown): ModelOption[] {
	const models = record(record(record(json).catalog).config).models;
	if (!Array.isArray(models)) return [];
	const main: ModelOption[] = [];
	const rest: ModelOption[] = [];
	const seen = new Set<string>();
	for (const raw of models) {
		const m = record(raw);
		if (typeof m.id !== 'string' || !MODEL_ID.test(m.id) || typeof m.name !== 'string' || seen.has(m.id)) continue;
		seen.add(m.id);
		const isMain = m.section === 'main';
		const hint = typeof m.description === 'string' ? m.description : isMain ? '' : 'An older model.';
		(isMain ? main : rest).push({ id: m.id, label: m.name, hint });
	}
	return [...main, ...rest];
}

/** The most recently written catalog file, parsed, or null. */
async function newestCatalog(dir: string): Promise<unknown> {
	try {
		const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
		const dated = await Promise.all(files.map(async (f) => ({ path: join(dir, f), at: (await stat(join(dir, f))).mtimeMs })));
		const newest = dated.sort((a, b) => b.at - a.at)[0];
		return newest ? JSON.parse(await readFile(newest.path, 'utf8')) : null;
	} catch {
		return null;
	}
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
