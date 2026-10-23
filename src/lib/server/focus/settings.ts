/**
 * Focus settings: how long the warm-up is, how early the wind-down nudge
 * comes, how late the follow-up, and by when a day without a plan is
 * mentioned. They live in `_hub/focus.md`'s frontmatter:
 *
 *     ---
 *     warmup_minutes: 5
 *     wind_down_minutes: 10
 *     follow_up_minutes: 10
 *     plan_by: "10:00"
 *     ---
 *
 * A missing file, key or unreadable value reads as the default, so the file
 * is optional. Writing rewrites only the keys given, every other byte kept.
 */

import { config } from '../config';
import { parseNote } from '../parse/note';
import { setFrontmatterField } from '../parse/frontmatter';
import { DEFAULT_RULES, type DueRules } from './due';
import { DEFAULT_WARMUP_MINUTES } from '$lib/shared/focus';
import type { Vault } from '../vault/index';

export const FOCUS_SETTINGS_PATH = `${config.hubFolder}/focus.md`;

/** The latest a "no plan yet" nudge may be set for; later than this it would not help the day. */
const DEFAULT_PLAN_BY = 10 * 60;

export interface FocusSettings {
	/** Minutes of "Just five minutes" before the clock shows the block's time left. */
	warmupMin: number;
	/** The rules `due.ts` judges blocks and nudges by, lead times included. */
	rules: DueRules;
	/** Minutes since midnight by which a day with no timed block gets one nudge. */
	planByMin: number;
}

/** Each setting's key in the file, and the whole minutes it may be. */
const LIMITS = {
	warmup_minutes: [1, 60],
	wind_down_minutes: [1, 60],
	follow_up_minutes: [1, 60]
} as const;

const minutes = (value: unknown, [lo, hi]: readonly [number, number]): number | null => {
	const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
	return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

const clock = (value: unknown): number | null => {
	const m = typeof value === 'string' ? /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim()) : null;
	return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function readSettings(content: string): FocusSettings {
	const fm = parseNote(content, FOCUS_SETTINGS_PATH).frontmatter;
	return {
		warmupMin: minutes(fm.warmup_minutes, LIMITS.warmup_minutes) ?? DEFAULT_WARMUP_MINUTES,
		rules: {
			...DEFAULT_RULES,
			windDownMin: minutes(fm.wind_down_minutes, LIMITS.wind_down_minutes) ?? DEFAULT_RULES.windDownMin,
			followUpMin: minutes(fm.follow_up_minutes, LIMITS.follow_up_minutes) ?? DEFAULT_RULES.followUpMin
		},
		planByMin: clock(fm.plan_by) ?? DEFAULT_PLAN_BY
	};
}

/** The settings in `_hub/focus.md`, defaults for anything missing or unreadable. Reads one file; never writes. */
export async function focusSettings(vault: Vault): Promise<FocusSettings> {
	return readSettings((await vault.read(FOCUS_SETTINGS_PATH)).content);
}

/** The settings as the Settings page edits them: whole minutes and an `HH:MM` time. */
export interface FocusSettingsPatch {
	warmupMin?: unknown;
	windDownMin?: unknown;
	followUpMin?: unknown;
	planBy?: unknown;
}

/**
 * Change any of the settings. Minutes are whole numbers from 1 to 60, given
 * as numbers or digits; `planBy` is `HH:MM`. A field left out stays as it is.
 *
 * Rewrites only the keys given in `_hub/focus.md`, or creates the file. Refuses
 * `invalid` for a value out of range or no field at all, and `conflict` when
 * another write got there first. Never throws. Answers the settings as now written.
 */
export async function setFocusSettings(
	vault: Vault,
	patch: FocusSettingsPatch
): Promise<({ ok: true } & FocusSettings) | { ok: false; reason: 'invalid' | 'conflict' }> {
	const fields: Array<[keyof typeof LIMITS, unknown]> = [
		['warmup_minutes', patch.warmupMin],
		['wind_down_minutes', patch.windDownMin],
		['follow_up_minutes', patch.followUpMin]
	];
	if (fields.every(([, v]) => v === undefined) && patch.planBy === undefined) return { ok: false, reason: 'invalid' };
	const note = await vault.read(FOCUS_SETTINGS_PATH);
	let text = note.exists ? note.content : NEW_FILE;
	for (const [key, value] of fields) {
		if (value === undefined) continue;
		const n = minutes(value, LIMITS[key]);
		if (n === null) return { ok: false, reason: 'invalid' };
		text = setFrontmatterField(text, key, n);
	}
	if (patch.planBy !== undefined) {
		const at = clock(patch.planBy);
		if (at === null) return { ok: false, reason: 'invalid' };
		text = setFrontmatterField(text, 'plan_by', hhmm(at));
	}
	const written = await vault.write(FOCUS_SETTINGS_PATH, text, note.hash);
	return written.ok ? { ok: true, ...readSettings(text) } : { ok: false, reason: 'conflict' };
}

const NEW_FILE = `---\n---\n\nFocus settings. \`warmup_minutes\` is how long a started block counts down\nbefore showing its time left. \`wind_down_minutes\` and \`follow_up_minutes\` are\nhow long before and after a block's start its nudges come. \`plan_by\` is when a\nday with no timed block gets one nudge.\n`;
