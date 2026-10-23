import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { focusSettings, setFocusSettings, FOCUS_SETTINGS_PATH } from './settings';
import { DEFAULT_RULES } from './due';
import { Vault } from '../vault/index';

const roots: string[] = [];
async function memoryVault(files: Record<string, string>): Promise<Vault> {
	const root = await mkdtemp(join(tmpdir(), 'prosoche-focus-settings-'));
	roots.push(root);
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	}
	return new Vault(root);
}
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('focus settings', () => {
	it('reads defaults when the file is missing', async () => {
		const vault = await memoryVault({});
		expect(await focusSettings(vault)).toEqual({ warmupMin: 5, rules: DEFAULT_RULES, planByMin: 600 });
	});

	it('reads what the file says and ignores what it cannot read', async () => {
		const vault = await memoryVault({ [FOCUS_SETTINGS_PATH]: '---\nwarmup_minutes: 3\nwind_down_minutes: 99\nfollow_up_minutes: "15"\nplan_by: "09:30"\n---\n' });
		const s = await focusSettings(vault);
		expect(s.warmupMin).toBe(3);
		expect(s.rules.windDownMin).toBe(DEFAULT_RULES.windDownMin);
		expect(s.rules.followUpMin).toBe(15);
		expect(s.planByMin).toBe(570);
	});

	it('writes only the keys given and refuses bad values', async () => {
		const vault = await memoryVault({ [FOCUS_SETTINGS_PATH]: '---\nwarmup_minutes: 3\n---\nmy words\n' });
		const set = await setFocusSettings(vault, { windDownMin: 20, planBy: '9:05' });
		expect(set).toMatchObject({ ok: true, warmupMin: 3, planByMin: 545, rules: { windDownMin: 20 } });
		const text = (await vault.read(FOCUS_SETTINGS_PATH)).content;
		expect(text).toContain('warmup_minutes: 3');
		expect(text).toContain('my words');
		expect(await setFocusSettings(vault, { warmupMin: 0 })).toEqual({ ok: false, reason: 'invalid' });
		expect(await setFocusSettings(vault, { planBy: '25:00' })).toEqual({ ok: false, reason: 'invalid' });
		expect(await setFocusSettings(vault, {})).toEqual({ ok: false, reason: 'invalid' });
	});

	it('creates the file when there is none', async () => {
		const vault = await memoryVault({});
		expect(await setFocusSettings(vault, { warmupMin: '2' })).toMatchObject({ ok: true, warmupMin: 2 });
		expect((await vault.read(FOCUS_SETTINGS_PATH)).content).toMatch(/^---\nwarmup_minutes: 2\n---\n/);
	});
});
