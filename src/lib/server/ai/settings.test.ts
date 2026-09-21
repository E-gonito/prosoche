import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { defaultSettings, fromFrontmatter, loadSettings, saveSettings, SETTINGS_PATH, toFrontmatter } from './settings';

let root: string;
let vault: Vault;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-ai-settings-'));
	vault = new Vault(root);
});
afterEach(async () => {
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

describe('defaults', () => {
	it('lives in _hub so it travels with the vault', () => {
		expect(SETTINGS_PATH).toBe('_hub/ai.md');
	});

	it('starts every feature at read-only or propose, never apply', () => {
		for (const [name, run] of Object.entries(defaultSettings().features)) {
			expect(run.permission, name).not.toBe('apply');
		}
	});

	it('is off until the user turns it on, and capped once they do', () => {
		// A vault with no `_hub/ai.md` has an owner who has not seen the
		// settings page. Nothing should run, and nothing should be spent.
		expect(defaultSettings().enabled).toBe(false);
		expect(defaultSettings().budget.dailyUsd).toBeGreaterThan(0);
	});
});

describe('fromFrontmatter', () => {
	it('fills in everything the file does not say', () => {
		expect(fromFrontmatter({})).toEqual(defaultSettings());
	});

	it('takes the values the file does say', () => {
		const settings = fromFrontmatter({
			enabled: false,
			daily_budget_usd: 2,
			features: { ask: { model: 'claude-opus-5', effort: 'high' } }
		});
		expect(settings.enabled).toBe(false);
		expect(settings.budget.dailyUsd).toBe(2);
		expect(settings.features.ask.model).toBe('claude-opus-5');
		expect(settings.features.ask.effort).toBe('high');
		// Untouched fields keep the shipped value.
		expect(settings.features.ask.permission).toBe('read-only');
		expect(settings.features.briefing.model).toBe('claude-sonnet-5');
	});

	it('lets a defaults block cover every feature, with a row overriding it', () => {
		const settings = fromFrontmatter({
			defaults: { model: 'claude-haiku-4-5-20251001' },
			features: { 'weekly-review': { model: 'claude-opus-5' } }
		});
		expect(settings.features.ask.model).toBe('claude-haiku-4-5-20251001');
		expect(settings.features['weekly-review'].model).toBe('claude-opus-5');
	});

	it('falls back to the safe value for a permission mode it does not know', () => {
		const settings = fromFrontmatter({ features: { capture: { permission: 'bypassPermissions' } } });
		expect(settings.features.capture.permission).toBe('propose');
	});

	it('falls back for a model or effort it does not know', () => {
		const settings = fromFrontmatter({ features: { ask: { model: 'gpt-9', effort: 'maximum' } } });
		expect(settings.features.ask.model).toBe('claude-sonnet-5');
		expect(settings.features.ask.effort).toBe('medium');
	});

	it('clamps a hand-typed budget or timeout rather than trusting it', () => {
		const settings = fromFrontmatter({
			daily_budget_usd: 10_000,
			features: { ask: { timeout_s: 99_999, budget_usd: -5 } }
		});
		expect(settings.budget.dailyUsd).toBe(100);
		expect(settings.features.ask.timeoutSeconds).toBe(900);
		expect(settings.features.ask.budgetUsd).toBe(0);
	});

	it('survives a file someone is halfway through editing', () => {
		expect(() => fromFrontmatter({ features: 'not a map', enabled: 'maybe' })).not.toThrow();
		expect(fromFrontmatter({ features: 'not a map' }).features.ask.model).toBe('claude-sonnet-5');
	});
});

describe('the round trip through the vault', () => {
	it('reads back what it wrote', async () => {
		const wanted = defaultSettings();
		wanted.enabled = false;
		wanted.features.ask.model = 'claude-opus-5';
		wanted.features.ask.effort = 'xhigh';
		wanted.features.capture.permission = 'propose';
		wanted.budget.dailyUsd = 3;

		await saveSettings(vault, wanted);
		expect(await loadSettings(vault)).toEqual(wanted);
	});

	it('writes something a person can read, not just frontmatter', async () => {
		await saveSettings(vault, defaultSettings());
		const note = await vault.read(SETTINGS_PATH);
		expect(note.content.startsWith('---\n')).toBe(true);
		expect(note.content).toContain('# AI settings');
		expect(note.content).toContain('kill switch');
		expect(note.content).toContain('| Feature | Model | Effort | Permission |');
	});

	it('says in the file that permissions are never skipped', async () => {
		await saveSettings(vault, defaultSettings());
		expect((await vault.read(SETTINGS_PATH)).content).toContain('dangerously-skip-permissions');
	});

	it('returns the defaults for a vault that has no settings file, without creating one', async () => {
		expect(await loadSettings(vault)).toEqual(defaultSettings());
		expect((await vault.read(SETTINGS_PATH)).exists).toBe(false);
	});

	it('survives a round trip through its own frontmatter object', () => {
		const wanted = defaultSettings();
		wanted.features.briefing.effort = 'low';
		expect(fromFrontmatter(toFrontmatter(wanted))).toEqual(wanted);
	});
});
