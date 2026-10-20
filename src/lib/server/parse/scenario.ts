/**
 * Reading one tactics scenario note, and saying exactly what is wrong with
 * one that does not read.
 *
 *     ---
 *     type: tactic-scenario
 *     id: ron-0001
 *     game: ron                 # ron | bodycam | shared
 *     drill: threat-call        # threat-call | hold-peek | squad-command | clear-order | recall
 *     tags: [roe.compliance, roe.escalation]
 *     difficulty: 2             # 1-5
 *     time_limit_s: 4
 *     provenance: own-aar       # own-aar | official | community | inferred
 *     source: ""
 *     verified_version: ""
 *     status: draft             # draft | approved | retired
 *     created: 2026-10-20
 *     roe_violation: [A]        # options that break the rules of engagement
 *     ---
 *
 *     ## Situation   markdown
 *     ## Map         a ```tactic-map fence of JSON (optional)
 *     ## Options     `- A: text` lines (choice drills)
 *     ## Answer      one acceptable answer per line: `B`, or `A1, A3, A2`
 *     ## Why         markdown, yours; `> [!suggestion]` marks a draft
 *     ## Penalty     optional, `roe_violation: [A]`, as the brief first wrote it
 *
 * This module only reads: approving a scenario rewrites its `status:` line
 * through `parse/frontmatter.ts`, and nothing re-serialises a scenario.
 * Pure: text and path in, a scenario or a list of problems out.
 */

import matter from 'gray-matter';
import {
	CHOICE_DRILLS,
	DIRECTIONS,
	DRILLS,
	ENTITY_TYPES,
	GAMES,
	PROVENANCES,
	STATUSES,
	type Option,
	type Point,
	type Scenario,
	type TacticMap
} from '$lib/shared/tactics';

export type ScenarioRead = { ok: true; scenario: Scenario } | { ok: false; id: string | null; errors: string[] };

const ID = /^[a-z0-9][a-z0-9-]*$/;
const TAG = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const FENCE = /^[ \t]*(```|~~~)/;
const SECTION = /^##[ \t]+(.+?)[ \t]*$/;
const OPTION = /^[ \t]*[-*+][ \t]+([A-Z])[:.)][ \t]*(.*)$/;
const SUGGESTION = /^[ \t]*>[ \t]*\[!suggestion\]/im;
const MAX_GRID = 40;

/**
 * The scenario `content` at `path` describes, or every problem found with
 * it, each a sentence naming the field or section. Problems are collected
 * rather than stopping at the first, so one edit can fix them all. `id` on
 * a failure is the note's id when it has a readable one. Never throws.
 */
export function parseScenario(content: string, path: string): ScenarioRead {
	let data: Record<string, unknown>;
	let body: string;
	try {
		const parsed = matter(content, {});
		data = (parsed.data ?? {}) as Record<string, unknown>;
		body = parsed.content;
	} catch (e) {
		return { ok: false, id: null, errors: [`The frontmatter is not valid YAML: ${firstLine(e)}`] };
	}

	const errors: string[] = [];
	const id = typeof data.id === 'string' && ID.test(data.id) ? data.id : null;
	if (!id) errors.push('`id:` is missing, or is not lower-case letters, digits and hyphens.');

	const game = oneOf(data.game, GAMES, 'game', errors);
	const drill = oneOf(data.drill, DRILLS, 'drill', errors);
	const provenance = oneOf(data.provenance, PROVENANCES, 'provenance', errors);
	const status = oneOf(data.status ?? 'draft', STATUSES, 'status', errors);

	const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
	if (!tags.length) errors.push('`tags:` needs at least one tag, such as `[cqb.corner]`.');
	for (const tag of tags) if (!TAG.test(tag)) errors.push(`Tag "${tag}" is not dot-namespaced lower case, like \`cqb.corner\`.`);

	const difficulty = Number(data.difficulty ?? 1);
	if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) errors.push('`difficulty:` is a whole number from 1 to 5.');
	const timeLimitS = Number(data.time_limit_s);
	if (!Number.isFinite(timeLimitS) || timeLimitS <= 0 || timeLimitS > 120) errors.push('`time_limit_s:` is a number of seconds, more than 0 and at most 120.');

	const sections = splitSections(body);
	const situation = sections.get('situation')?.trim() ?? '';
	if (!situation) errors.push('`## Situation` is missing or empty.');

	const map = sections.has('map') ? readMap(sections.get('map')!, errors) : null;
	const options = readOptions(sections.get('options') ?? '', errors);
	const answerLines = (sections.get('answer') ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
	const why = sections.get('why')?.trim() ?? '';
	const whySuggested = SUGGESTION.test(why);

	const roeViolation = [...list(data.roe_violation), ...penaltyLine(sections.get('penalty') ?? '')].map((k) => k.toUpperCase());

	let answers: string[][] = [];
	if (drill && CHOICE_DRILLS.includes(drill)) {
		if (options.length < 2) errors.push('`## Options` needs at least two `- A: …` lines.');
		const keys = new Set(options.map((o) => o.key));
		answers = answerLines.map((l) => [l.replace(/[:.)].*$/, '').trim().toUpperCase()]);
		if (!answers.length) errors.push('`## Answer` is empty: write the letter of the right option.');
		for (const [key] of answers) {
			if (!keys.has(key)) errors.push(`The answer "${key}" is not one of the options.`);
			if (roeViolation.includes(key)) errors.push(`The answer "${key}" is also listed as an ROE violation.`);
		}
		for (const key of roeViolation) if (!keys.has(key)) errors.push(`The ROE violation "${key}" is not one of the options.`);
	} else if (drill === 'clear-order') {
		const angles = new Set(map?.angles.map((a) => a.id) ?? []);
		if (!map || !angles.size) errors.push('A `clear-order` drill needs a `## Map` with at least one angle.');
		answers = answerLines.map((l) => l.split(/\s*(?:,|>|→)\s*/).filter(Boolean));
		if (!answers.length) errors.push('`## Answer` is empty: write the angle ids in order, like `A1, A3, A2`.');
		for (const order of answers) {
			const unknown = order.filter((step) => !angles.has(step));
			if (unknown.length) errors.push(`The answer "${order.join(', ')}" names ${unknown.map((u) => `"${u}"`).join(', ')}, not an angle on the map.`);
			if (new Set(order).size !== order.length) errors.push(`The answer "${order.join(', ')}" names an angle twice.`);
		}
		if (new Set(answers.map((a) => a.length)).size > 1) errors.push('Every acceptable order in `## Answer` should clear the same number of angles.');
	}

	if (status === 'approved') {
		if (!why) errors.push('An approved scenario needs a `## Why`, in your words.');
		else if (whySuggested) errors.push('The `## Why` is still marked `> [!suggestion]`: rewrite it in your words before approving.');
	}

	if (errors.length || !id || !game || !drill || !provenance || !status) return { ok: false, id, errors };
	return {
		ok: true,
		scenario: {
			id,
			path,
			game,
			drill,
			tags,
			difficulty,
			timeLimitS,
			provenance,
			source: text(data.source),
			verifiedVersion: text(data.verified_version),
			status,
			created: text(data.created),
			situation,
			map,
			options,
			answers,
			why,
			whySuggested,
			roeViolation
		}
	};
}

/**
 * `content` with the `## <heading>` section's body set to `body`, every
 * other byte kept.
 *
 * The heading is matched ignoring case, outside fences and below the
 * frontmatter. Its old body (every line up to the next `##` heading or the
 * end) is replaced by `body` and one blank line before the next heading. A
 * section that is not there is added before the first of `before` that is,
 * or at the end. Pure; never touches the frontmatter or another section.
 */
export function setSection(content: string, heading: string, body: string, before: string[] = []): string {
	const lines = content.split('\n');
	const found = sectionLines(lines);
	const text = body.replace(/\s+$/, '').split('\n');
	const at = found.find((s) => s.name === heading.toLowerCase());
	if (at) {
		// The trailing '' is the blank line before the next heading, or the
		// file's final newline when this is the last section.
		lines.splice(at.start + 1, at.end - at.start - 1, ...text, '');
		return lines.join('\n');
	}
	const next = before.map((b) => found.find((s) => s.name === b.toLowerCase())).find(Boolean);
	if (next) {
		lines.splice(next.start, 0, `## ${heading}`, ...text, '');
		return lines.join('\n');
	}
	const head = content.replace(/\s*$/, '');
	return `${head}\n\n## ${heading}\n${text.join('\n')}\n`;
}

/** The `## <heading>` section's body as written, trailing blank lines dropped; null when there is none. Pure. */
export function sectionText(content: string, heading: string): string | null {
	const lines = content.split('\n');
	const at = sectionLines(lines).find((s) => s.name === heading.toLowerCase());
	return at ? lines.slice(at.start + 1, at.end).join('\n').replace(/\s+$/, '') : null;
}

/** Where each `##` section starts and ends, as line indexes, frontmatter and fences skipped. */
function sectionLines(lines: string[]): Array<{ name: string; start: number; end: number }> {
	let i = 0;
	if (lines[0]?.replace(/\r$/, '') === '---') {
		const close = lines.findIndex((l, n) => n > 0 && l.replace(/\r$/, '') === '---');
		i = close === -1 ? lines.length : close + 1;
	}
	const out: Array<{ name: string; start: number; end: number }> = [];
	let fence: string | null = null;
	for (; i < lines.length; i++) {
		const f = FENCE.exec(lines[i]);
		if (f) {
			fence = fence === null ? f[1] : f[1] === fence ? null : fence;
			continue;
		}
		const h = fence === null ? SECTION.exec(lines[i]) : null;
		if (!h) continue;
		if (out.length) out[out.length - 1].end = i;
		out.push({ name: h[1].toLowerCase(), start: i, end: lines.length });
	}
	return out;
}

/** The body's `##` sections by lower-cased heading, fences respected. Text above the first is dropped. */
function splitSections(body: string): Map<string, string> {
	const out = new Map<string, string>();
	let current: string | null = null;
	let fence: string | null = null;
	for (const line of body.split('\n')) {
		const f = FENCE.exec(line);
		if (f) fence = fence === null ? f[1] : f[1] === fence ? null : fence;
		const h = fence === null && !f ? SECTION.exec(line) : null;
		if (h) {
			current = h[1].toLowerCase();
			out.set(current, '');
		} else if (current !== null) out.set(current, `${out.get(current)}${line}\n`);
	}
	return out;
}

function readOptions(section: string, errors: string[]): Option[] {
	const out: Option[] = [];
	for (const line of section.split('\n')) {
		const m = OPTION.exec(line);
		if (!m) continue;
		if (out.some((o) => o.key === m[1])) errors.push(`Option ${m[1]} is listed twice.`);
		else out.push({ key: m[1], text: m[2].trim() });
	}
	return out;
}

/** `roe_violation: [A, C]` from the brief's `## Penalty` section. */
function penaltyLine(section: string): string[] {
	const m = /roe_violation:\s*\[([^\]]*)\]/.exec(section);
	return m ? m[1].split(',').map((k) => k.trim()).filter(Boolean) : [];
}

/**
 * The map in a `## Map` section's ```tactic-map fence, checked against
 * version 1 of the schema; null, with the problems pushed, when it is not
 * one. A section with no such fence is a problem too: an empty `## Map` is
 * more likely a fence typed wrong than a map left out.
 */
function readMap(section: string, errors: string[]): TacticMap | null {
	const m = /^[ \t]*(```|~~~)[ \t]*tactic-map[ \t]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/m.exec(section);
	if (!m) {
		errors.push('`## Map` has no ```tactic-map fence.');
		return null;
	}
	let raw: unknown;
	try {
		raw = JSON.parse(m[2]);
	} catch (e) {
		errors.push(`The map is not valid JSON: ${firstLine(e)}`);
		return null;
	}
	return checkMap(raw, errors);
}

/** `raw` as a version 1 map, or null with every problem pushed onto `errors`. Exported for the table test. */
export function checkMap(raw: unknown, errors: string[]): TacticMap | null {
	const before = errors.length;
	const say = (problem: string) => errors.push(`Map: ${problem}`);
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		say('it should be a JSON object.');
		return null;
	}
	const o = raw as Record<string, unknown>;
	if (o.v !== undefined && o.v !== 1) say(`version ${JSON.stringify(o.v)} is not one this reads; use "v": 1.`);

	const grid = isPoint(o.grid) && o.grid.every((n) => Number.isInteger(n) && n > 0 && n <= MAX_GRID) ? (o.grid as Point) : null;
	if (!grid) say(`"grid" is [width, height], whole numbers from 1 to ${MAX_GRID}.`);
	const inside = (p: Point) => !grid || (p[0] >= 0 && p[1] >= 0 && p[0] <= grid[0] && p[1] <= grid[1]);
	const point = (p: unknown, what: string): Point | null => {
		if (!isPoint(p)) return say(`${what} needs "at" or "from" as [x, y].`), null;
		if (!inside(p)) return say(`${what} at [${p.join(', ')}] is off the grid.`), null;
		return p;
	};

	const walls: TacticMap['walls'] = [];
	for (const w of arrayOf(o.walls, 'walls', say)) {
		if (Array.isArray(w) && w.length === 4 && w.every((n) => typeof n === 'number') && inside([w[0], w[1]]) && inside([w[2], w[3]])) walls.push(w as [number, number, number, number]);
		else say(`a wall ${JSON.stringify(w)} is not [x1, y1, x2, y2] on the grid.`);
	}

	const ids = new Set<string>();
	const named = (x: unknown, what: string): string | null => {
		const id = (x as { id?: unknown })?.id;
		if (typeof id !== 'string' || !id) return say(`a ${what} has no "id".`), null;
		if (ids.has(id)) return say(`the id "${id}" is used twice.`), null;
		ids.add(id);
		return id;
	};

	const doors: TacticMap['doors'] = [];
	for (const d of arrayOf(o.doors, 'doors', say)) {
		const id = named(d, 'door');
		const at = point((d as { at?: unknown })?.at, `door ${id ?? '?'}`);
		if (id && at) doors.push({ id, at });
	}

	const angles: TacticMap['angles'] = [];
	for (const a of arrayOf(o.angles, 'angles', say)) {
		const id = named(a, 'angle');
		const from = point((a as { from?: unknown })?.from, `angle ${id ?? '?'}`);
		const dir = (a as { dir?: unknown })?.dir;
		if (!DIRECTIONS.includes(dir as never)) say(`angle ${id ?? '?'} has "dir" ${JSON.stringify(dir)}; use one of ${DIRECTIONS.join(', ')}.`);
		else if (id && from) angles.push({ id, from, dir: dir as TacticMap['angles'][number]['dir'] });
	}

	const entities: TacticMap['entities'] = [];
	for (const e of arrayOf(o.entities, 'entities', say)) {
		const type = (e as { type?: unknown })?.type;
		const at = point((e as { at?: unknown })?.at, `${String(type ?? 'an entity')}`);
		const state = (e as { state?: unknown })?.state;
		if (!ENTITY_TYPES.includes(type as never)) say(`an entity has "type" ${JSON.stringify(type)}; use one of ${ENTITY_TYPES.join(', ')}.`);
		else if (state !== undefined && typeof state !== 'string') say(`a ${String(type)}'s "state" should be text.`);
		else if (at) entities.push({ type: type as TacticMap['entities'][number]['type'], at, state: state ?? '' });
	}

	if (errors.length > before || !grid) return null;
	return { v: 1, grid, walls, doors, angles, entities };
}

function arrayOf(value: unknown, name: string, say: (problem: string) => void): unknown[] {
	if (value === undefined) return [];
	if (Array.isArray(value)) return value;
	say(`"${name}" should be a list.`);
	return [];
}

function isPoint(p: unknown): p is Point {
	return Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], key: string, errors: string[]): T | null {
	if (allowed.includes(value as T)) return value as T;
	errors.push(`\`${key}:\` is ${value === undefined ? 'missing' : `"${String(value)}"`}; it is one of ${allowed.join(', ')}.`);
	return null;
}

function list(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String);
	if (typeof value === 'string' && value.trim()) return value.split(',').map((v) => v.trim());
	return [];
}

/** A frontmatter value as text. YAML reads an unquoted `2026-10-20` as a date and `1.4` as a number. */
function text(value: unknown): string {
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	return value === undefined || value === null ? '' : String(value);
}

function firstLine(e: unknown): string {
	return (e instanceof Error ? e.message : String(e)).split('\n')[0];
}
