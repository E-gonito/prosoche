/**
 * The tactics trainer over the vault: its scenarios, its attempt log, a
 * mission to play, a played mission recorded, a scenario approved.
 *
 * Everything lives under `config.tacticsFolder`:
 *
 *     Tactics/Scenarios/<id>.md     one scenario each (see `parse/scenario.ts`)
 *     Tactics/Attempts/<YYYY-MM>.md the attempt log (see `parse/attempts.ts`)
 *     Tactics/To verify in game.md  claims waiting for you to test
 *
 * The log is the trainer's only state: accuracy per tag, which difficulties
 * are open and what is due are all replayed from it on each read (see
 * `sampler.ts`), so there is nothing to keep in step and nothing in SQLite.
 *
 * Writes, and the rule each keeps:
 *  - Recording a mission only appends lines to a log file, against the hash
 *    it read, so a line written meanwhile from elsewhere is never lost.
 *  - Changing a scenario's status rewrites its `status:` line and nothing
 *    else. No model code path calls it: approving is yours.
 *  - Adding the starter drafts creates files that are not there and never
 *    overwrites one.
 */

import { config } from '../config';
import { parseScenario } from '../parse/scenario';
import { formatAttempt, isStamp, logFileFor, parseAttempts } from '../parse/attempts';
import { setFrontmatterField } from '../parse/frontmatter';
import { renderNote } from '../render';
import { ATTEMPTS, SCENARIOS } from './paths';
import { pickMission, type Rng } from './sampler';
import {
	judge,
	tagAccuracy,
	CHOICE_DRILLS,
	MODES,
	STATUSES,
	TACTICS,
	type Attempt,
	type Device,
	type Judged,
	type Mode,
	type Scenario,
	type ScenarioView,
	type Status,
	type TagStat
} from '$lib/shared/tactics';
import type { Vault } from '../vault/index';

const MISSION_ID = /^m-[0-9a-z-]{1,40}$/;

/** A scenario note that did not read, and why. */
export interface ScenarioProblem {
	path: string;
	id: string | null;
	errors: string[];
}

export interface Library {
	scenarios: Scenario[];
	problems: ScenarioProblem[];
}

type Refusal = { ok: false; reason: string; message?: string };

/**
 * Every scenario note under `Tactics/Scenarios/`, at any depth, and every
 * one that did not read. A second note with an id already taken is a
 * problem rather than a silent replacement. Reads the vault only.
 */
export async function loadLibrary(vault: Vault): Promise<Library> {
	const scenarios: Scenario[] = [];
	const problems: ScenarioProblem[] = [];
	const seen = new Map<string, string>();
	for (const name of await vault.files(SCENARIOS, 'md', { deep: true })) {
		const path = `${SCENARIOS}/${name}`;
		const read = parseScenario((await vault.read(path)).content, path);
		if (!read.ok) problems.push({ path, id: read.id, errors: read.errors });
		else if (seen.has(read.scenario.id)) problems.push({ path, id: read.scenario.id, errors: [`The id "${read.scenario.id}" is already used by ${seen.get(read.scenario.id)}.`] });
		else {
			seen.set(read.scenario.id, path);
			scenarios.push(read.scenario);
		}
	}
	return { scenarios, problems };
}

/** Every attempt in the log, oldest first. A log that is not there is empty. Reads the vault only. */
export async function loadAttempts(vault: Vault): Promise<Attempt[]> {
	const out: Attempt[] = [];
	for (const name of await vault.files(ATTEMPTS, 'md')) out.push(...parseAttempts((await vault.read(`${ATTEMPTS}/${name}`)).content));
	return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Whether `scenario` can be served in `mode`. Ready or Not and Bodycam missions both include the shared CQB core. Pure. */
export function inMode(scenario: Scenario, mode: Mode): boolean {
	if (mode === 'aar-review') return scenario.provenance === 'own-aar';
	return scenario.game === mode || scenario.game === 'shared';
}

/**
 * The scenarios a mission may serve: playable drills in the mode, drafts and
 * approved alike, never retired ones. A generated draft plays as soon as it
 * is in the vault; nothing waits on approval. Pure.
 */
export function missionPool(scenarios: readonly Scenario[], mode: Mode): Scenario[] {
	const playable = (s: Scenario) => s.drill === 'clear-order' || CHOICE_DRILLS.includes(s.drill);
	return scenarios.filter((s) => playable(s) && s.status !== 'retired' && inMode(s, mode));
}

/** What the trainer's front page shows. */
export interface Overview {
	library: Library;
	/** Per tag, weakest first, over every scenario not retired. */
	tags: Array<{ tag: string } & TagStat>;
	/** How many scenarios each mode could serve. */
	pools: Record<Mode, number>;
	attempts: number;
	hasFolder: boolean;
}

/** The library, accuracy per tag, and what each mode could serve. Reads the vault only. */
export async function overview(vault: Vault): Promise<Overview> {
	const [library, attempts] = await Promise.all([loadLibrary(vault), loadAttempts(vault)]);
	const stats = tagAccuracy(attempts, byId(library.scenarios));
	const tags = [...new Set(library.scenarios.filter((s) => s.status !== 'retired').flatMap((s) => s.tags))]
		.map((tag) => ({ tag, ...(stats[tag] ?? { accuracy: TACTICS.prior, answers: 0 }) }))
		.sort((a, b) => a.accuracy - b.accuracy || a.tag.localeCompare(b.tag));
	const pools = Object.fromEntries(MODES.map((m) => [m, missionPool(library.scenarios, m).length])) as Overview['pools'];
	const hasFolder = library.scenarios.length + library.problems.length > 0;
	return { library, tags, pools, attempts: attempts.length, hasFolder };
}

/** A mission ready to play: its drills in order, and accuracy per tag before it. */
export interface MissionPlan {
	drills: Scenario[];
	tags: Record<string, TagStat>;
}

/**
 * Choose a mission of `length` drills (clamped to `TACTICS.length`) for
 * `mode` on `today`, weakest tags first (see `sampler.ts`). Fewer when the
 * pool is smaller; none when it is empty. Reads the vault only.
 */
export async function planMission(
	vault: Vault,
	input: { mode: Mode; length: number },
	today: string,
	rng: Rng = Math.random
): Promise<MissionPlan> {
	const [library, attempts] = await Promise.all([loadLibrary(vault), loadAttempts(vault)]);
	const length = Math.min(TACTICS.length.max, Math.max(TACTICS.length.min, Math.round(input.length) || TACTICS.length.default));
	const pool = missionPool(library.scenarios, input.mode);
	return { drills: pickMission(pool, attempts, today, length, rng), tags: tagAccuracy(attempts, byId(library.scenarios)) };
}

/** One answered drill as the browser sends it. */
export interface PlayedDrill {
	scenario: string;
	answer: string[] | null;
	ms: number;
	at: string;
}

/**
 * Append a played mission to the log, one line per drill, judging each
 * answer again here rather than trusting the browser's verdict. Latency is
 * the browser's to measure, and taken as sent.
 *
 * Input, untrusted: `{ mission, device, drills }`. Refuses `invalid` for a
 * malformed mission or drill and `not-found` for a scenario no longer in
 * the library; nothing is written then. Answers the attempts written, each
 * with its verdict. Appends to the monthly file each attempt's timestamp
 * names, re-reading and retrying once if that file changed between the
 * read and the write. Never rewrites an existing line.
 */
export async function recordMission(
	vault: Vault,
	body: { mission?: unknown; device?: unknown; drills?: unknown }
): Promise<{ ok: true; attempts: Array<Attempt & Judged> } | Refusal> {
	const mission = typeof body.mission === 'string' && MISSION_ID.test(body.mission) ? body.mission : null;
	const device: Device = body.device === 'phone' ? 'phone' : 'pc';
	const drills = Array.isArray(body.drills) ? (body.drills as unknown[]) : null;
	if (!mission || !drills?.length || drills.length > TACTICS.length.max) return { ok: false, reason: 'invalid', message: 'A mission needs an id and its answered drills.' };

	const library = byId((await loadLibrary(vault)).scenarios);
	const out: Array<Attempt & Judged> = [];
	for (const raw of drills) {
		const d = raw as Partial<PlayedDrill>;
		const answer = d.answer === null ? null : Array.isArray(d.answer) && d.answer.every((s) => typeof s === 'string' && /^[A-Za-z0-9-]{1,12}$/.test(s)) ? d.answer : undefined;
		if (typeof d.scenario !== 'string' || answer === undefined || typeof d.ms !== 'number' || d.ms < 0 || !isStamp(d.at)) {
			return { ok: false, reason: 'invalid', message: 'A drill needs its scenario, answer, time taken and when.' };
		}
		const scenario = library.get(d.scenario);
		if (!scenario) return { ok: false, reason: 'not-found', message: `There is no scenario "${d.scenario}" any more.` };
		const judged = judge(scenario, answer, d.ms);
		out.push({ at: d.at, scenario: scenario.id, mission, answer: judged.result === 'timeout' ? null : answer, ms: Math.round(d.ms), device, ...judged });
	}

	const byFile = new Map<string, string[]>();
	for (const a of out) byFile.set(logFileFor(a.at), [...(byFile.get(logFileFor(a.at)) ?? []), formatAttempt(a)]);
	for (const [name, lines] of byFile) {
		const path = `${ATTEMPTS}/${name}`;
		for (let tries = 0; ; tries++) {
			const note = await vault.read(path);
			const head = note.exists ? note.content.replace(/\n*$/, '\n') : `# Tactics attempts, ${name.slice(0, 7)}\n\n`;
			const written = await vault.write(path, `${head}${lines.join('\n')}\n`, note.hash);
			if (written.ok) break;
			if (tries >= 1) return { ok: false, reason: 'conflict' };
		}
	}
	return { ok: true, attempts: out };
}

/**
 * Set scenario `id`'s status to `status`, rewriting its `status:` line and
 * nothing else, against the note as it was read. Approving checks the note
 * as it would read once approved, so a missing or still-suggested `## Why`
 * refuses (`invalid`, with the problems) and nothing is written. Refuses
 * `not-found` for an id not in the library and `conflict` if the note
 * changed under it. No model code path calls this.
 */
export async function setStatus(vault: Vault, id: unknown, status: unknown): Promise<{ ok: true; status: Status } | (Refusal & { errors?: string[] })> {
	if (!STATUSES.includes(status as Status)) return { ok: false, reason: 'invalid', message: 'A status is draft, approved or retired.' };
	const scenario = (await loadLibrary(vault)).scenarios.find((s) => s.id === id);
	if (!scenario) return { ok: false, reason: 'not-found', message: 'There is no such scenario, or it does not read. Fix it first.' };
	const note = await vault.read(scenario.path);
	const next = setFrontmatterField(note.content, 'status', status as Status);
	const check = parseScenario(next, scenario.path);
	if (!check.ok) return { ok: false, reason: 'invalid', message: check.errors.join(' '), errors: check.errors };
	const written = await vault.write(scenario.path, next, note.hash);
	return written.ok ? { ok: true, status: status as Status } : { ok: false, reason: 'conflict' };
}

/**
 * The starter notes shipped with the app: a handful of `shared` CQB
 * scenarios, every one `provenance: inferred` and `status: draft`, and the
 * list of claims to verify in game. Keyed by vault path.
 */
const STARTERS: Record<string, string> = Object.fromEntries(
	Object.entries(import.meta.glob('./starters/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>).map(([file, content]) => [
		`${config.tacticsFolder}/${file.replace('./starters/', '')}`,
		content
	])
);

/**
 * Write each starter note that is not in the vault yet; never overwrites
 * one, so pressing it again after editing a draft changes nothing. Answers
 * the paths written. The only call that creates scenarios, and it is a
 * button you press.
 */
export async function addStarters(vault: Vault): Promise<{ ok: true; written: string[] }> {
	const written: string[] = [];
	for (const [path, content] of Object.entries(STARTERS)) {
		if ((await vault.read(path)).exists) continue;
		if ((await vault.write(path, content, '')).ok) written.push(path);
	}
	return { ok: true, written };
}

/** The vault path of every starter note, for a test. */
export const STARTER_PATHS = Object.keys(STARTERS);

/**
 * `scenario` for the browser, its Situation and Why rendered with wikilinks
 * resolved through `index`, and the Why's `> [!suggestion]` marker taken
 * off (the view says so in words instead). Reads the index only.
 */
export function viewOf(scenario: Scenario, index: { resolveLink(target: string): string | null }): ScenarioView {
	const why = scenario.why.replace(/^[ \t]*>[ \t]*\[!suggestion\][^\n]*\n?/im, '');
	return { ...scenario, situationHtml: renderNote(index, scenario.situation), whyHtml: why.trim() ? renderNote(index, why) : '' };
}

function byId(scenarios: readonly Scenario[]): Map<string, Scenario> {
	return new Map(scenarios.map((s) => [s.id, s]));
}
