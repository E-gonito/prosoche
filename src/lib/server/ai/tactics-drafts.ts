/**
 * What Claude drafts for the tactics trainer: new scenarios, and
 * suggestions for a scenario already drafted.
 *
 * Nothing in this file writes to the vault, and nothing it proposes is a
 * fact. New scenarios are `provenance: inferred`, `status: draft`, with the
 * Why marked `> [!suggestion]`, and play in missions as soon as you accept
 * the proposal that writes them; retire one that proves wrong in game. The
 * model answers in fields; our code
 * writes the notes with `scenarioNote`, and every one is read back through
 * `parseScenario` before it is offered, so a malformed draft is dropped
 * rather than written.
 *
 * Two rules from the trainer's brief are code here, not prompt: no Ready or
 * Not rules-of-engagement scenarios are generated (no `threat-call` drill,
 * no `roe.*` tag, no ROE violations), because those claims are community
 * folklore until verified in game; and a suggestion never touches `status:`
 * or an approved scenario.
 */

import { checkMap, parseScenario, scenarioNote, sectionText, setSection } from '../parse/scenario';
import { setFrontmatterField } from '../parse/frontmatter';
import { loadLibrary } from '../tactics/index';
import { nextId, takenIds } from '../tactics/aar';
import { AARS, SCENARIOS } from '../tactics/paths';
import { wrapAsData, type Schema } from './guardrails';
import { gather, nothing, runDraft, type DraftOptions, type DraftResult } from './run';
import { newId } from './proposal';
import { CHOICE_DRILLS, GAMES, type DrillKind, type Game, type Scenario, type TacticMap } from '$lib/shared/tactics';
import type { Proposal, ProposalEdit, RunStamp } from '$lib/shared/ai';
import type { Vault } from '../vault/index';

const TAG = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const MAX_NEW = 5;

/** The tags the trainer starts with; the model may use others in the same style. */
export const TAXONOMY = [
	'cqb.corner', 'cqb.threshold', 'cqb.multi-angle', 'cqb.pie', 'cqb.tempo', 'cqb.repeek', 'cqb.reload', 'cqb.rear',
	'ron.clear-order', 'ron.squad-cmd', 'ron.breach', 'ron.evidence', 'ron.arrest',
	'bc.peek', 'bc.hold', 'bc.sound', 'bc.drone', 'bc.trade', 'bc.site-exec', 'bc.retake'
];

/** The drills Claude may draft for each game: never `threat-call`, which is about the rules of engagement. */
const DRAFTABLE: Record<Game, DrillKind[]> = {
	ron: ['hold-peek', 'squad-command', 'clear-order'],
	bodycam: ['hold-peek', 'clear-order'],
	shared: ['hold-peek', 'clear-order']
};

const MAP_SPEC = [
	'A map, when you give one, is a JSON string of this shape, origin top left, N up the screen, grid at most 20 by 20:',
	'{"v":1,"grid":[w,h],"walls":[[x1,y1,x2,y2]],"doors":[{"id":"D1","at":[x,y]}],',
	'"angles":[{"id":"A1","from":[x,y],"dir":"N|NE|E|SE|S|SW|W|NW"}],',
	'"entities":[{"type":"player|teammate|suspect|civilian|enemy","at":[x,y],"state":"two or three words"}]}',
	'Every point must be on the grid. Leave a gap in a wall where a door is.'
].join('\n');

/** Tags as the trainer accepts them: lower case, dot-namespaced, never `roe.*`, at most four. Pure. */
function cleanTags(tags: string[]): string[] {
	return [...new Set(tags.map((t) => t.trim().toLowerCase()))].filter((t) => TAG.test(t) && !t.startsWith('roe.')).slice(0, 4);
}

/** A map from the model's JSON string, or null when it is not a valid version 1 map. Pure. */
function readMap(text: string | undefined): TacticMap | null {
	if (!text?.trim()) return null;
	try {
		const errors: string[] = [];
		return checkMap(JSON.parse(text), errors);
	} catch {
		return null;
	}
}

/* ---------------------------------------------------------- generate -- */

interface Drafted {
	drill: string;
	situation: string;
	options: string[];
	answer: string;
	tags: string[];
	difficulty: number;
	time_limit_s: number;
	map?: string;
	why: string;
}

const GENERATE_SCHEMA: Schema = {
	type: 'object',
	fields: {
		scenarios: {
			type: 'array',
			maxItems: MAX_NEW,
			of: {
				type: 'object',
				fields: {
					drill: { type: 'string', enum: ['hold-peek', 'squad-command', 'clear-order'] },
					situation: { type: 'string', minLength: 20, maxLength: 900 },
					options: { type: 'array', maxItems: 5, of: { type: 'string', minLength: 1, maxLength: 200 } },
					answer: { type: 'string', minLength: 1, maxLength: 60 },
					tags: { type: 'array', maxItems: 4, of: { type: 'string', minLength: 3, maxLength: 40 } },
					difficulty: { type: 'number', integer: true, min: 1, max: 5 },
					time_limit_s: { type: 'number', integer: true, min: 3, max: 20 },
					map: { type: 'string', maxLength: 4000 },
					why: { type: 'string', minLength: 1, maxLength: 900 }
				},
				optional: ['map']
			}
		}
	}
};

/** What to draft: for which game, around which tags or topic, how many. */
export interface GenerateRequest {
	game: Game;
	tags: string[];
	topic: string;
	count: number;
}

/** The request from the browser, checked; null when it is not one. Pure. */
export function readGenerateRequest(body: Record<string, unknown>): GenerateRequest | null {
	const game = GAMES.find((g) => g === body.game);
	if (!game) return null;
	const tags = cleanTags(Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : []);
	const topic = typeof body.topic === 'string' ? body.topic.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
	const count = Math.min(MAX_NEW, Math.max(1, Math.round(Number(body.count) || 3)));
	return { game, tags, topic, count };
}

/**
 * The prompt for new scenarios. Pure. It lists the scenarios that exist, so
 * none is drafted twice, and passes the user's after-action reviews as data,
 * the best source of what they actually get wrong.
 */
export function generatePrompt(input: GenerateRequest & { existing: string[]; sources: Array<{ path: string; text: string }> }): string {
	const game = { ron: 'Ready or Not (PvE SWAT, played solo with the AI squad)', bodycam: 'Bodycam (PvP, no HUD, played mostly as Deathmatch)', shared: 'close-quarters fundamentals that hold in both Ready or Not and Bodycam' }[input.game];
	return [
		`Draft ${input.count} new training scenario${input.count === 1 ? '' : 's'} for a decision trainer: ${game}.`,
		...(input.tags.length ? [`Focus on these skills, the user's weakest: ${input.tags.join(', ')}.`] : []),
		...(input.topic ? [`What the user asked for: ${input.topic}`] : []),
		'',
		'Each scenario is one decision under a few seconds of time pressure, about position, angles, timing or squad orders.',
		'Do not write about aim, recoil or movement technique, and nothing about the rules of engagement, compliance or',
		'when force is justified. Write general principles, not claims about game mechanics, weapon stats or patch details;',
		'these are drafts the user will test in game.',
		'',
		`Drills you may use: ${DRAFTABLE[input.game].join(', ')}.`,
		'- hold-peek or squad-command: 3 or 4 options, one clearly best and the others plausible mistakes a real player makes;',
		'  answer is its letter (A for the first option, B for the second, and so on).',
		'- clear-order: no options; a map with 2 to 4 angles is required; answer is the angle ids in order, like "A1, A3, A2".',
		'situation: second person, present tense, two or three sentences, everything needed and nothing more.',
		`tags: one to three, dot-namespaced, from: ${TAXONOMY.filter((t) => input.game === 'shared' ? t.startsWith('cqb.') : !t.startsWith(input.game === 'ron' ? 'bc.' : 'ron.')).join(', ')}.`,
		'difficulty 1 (obvious) to 5 (subtle); time_limit_s 4 to 8 for a choice, 6 to 12 for a clear-order.',
		'why: the reasoning in two to four plain sentences, why the answer beats each tempting alternative.',
		'',
		MAP_SPEC,
		'Give a map for a choice drill only when positions matter to the decision.',
		'',
		...(input.existing.length ? ['Scenarios that already exist, do not repeat them:', ...input.existing.map((e) => `- ${e}`), ''] : []),
		input.sources.length ? 'The user\'s after-action reviews, the mistakes they actually make:' : '',
		wrapAsData(input.sources)
	].join('\n');
}

/**
 * The drafted scenarios as one proposal, one new note each, numbered from
 * the first ids free in `taken`. Pure. A draft that breaks a rule above, or
 * does not read back as a scenario, is dropped and counted. Null when none
 * is left.
 */
export function generateProposal(
	request: GenerateRequest,
	drafted: Drafted[],
	taken: ReadonlySet<string>,
	day: string,
	stamp: RunStamp
): { proposal: Proposal | null; dropped: number } {
	const ids = new Set(taken);
	const edits: ProposalEdit[] = [];
	let dropped = 0;
	for (const d of drafted.slice(0, request.count)) {
		const drill = DRAFTABLE[request.game].find((k) => k === d.drill);
		const tags = cleanTags(d.tags);
		const map = readMap(d.map);
		if (!drill || !tags.length || (drill === 'clear-order' && !map)) {
			dropped++;
			continue;
		}
		const id = nextId(request.game, ids);
		const note = scenarioNote({
			id,
			game: request.game,
			drill,
			tags,
			difficulty: d.difficulty,
			timeLimitS: d.time_limit_s,
			provenance: 'inferred',
			source: `Drafted by Claude on ${day}${request.topic ? `: ${request.topic}` : ''}. Not verified in game.`,
			created: day,
			situation: d.situation,
			map,
			options: CHOICE_DRILLS.includes(drill) ? d.options : [],
			answer: d.answer,
			why: d.why,
			whySuggested: true
		});
		const path = `${SCENARIOS}/${id}.md`;
		if (!parseScenario(note, path).ok) {
			dropped++;
			continue;
		}
		ids.add(id);
		edits.push({ id: newId('edit'), kind: 'append', path, text: note, reason: `A new scenario, ${id}: inferred, not checked in game. It plays once accepted.` });
	}
	if (!edits.length) return { proposal: null, dropped };
	return {
		dropped,
		proposal: {
			id: newId('generate'),
			feature: 'tactics-generate',
			stamp,
			summary: `${edits.length} new scenario${edits.length === 1 ? '' : 's'}${dropped ? ` (${dropped} dropped for not reading as a scenario)` : ''}. Each is inferred, not checked in game, and plays once accepted.`,
			edits,
			accepted: []
		}
	};
}

/**
 * Draft new scenarios for `request`. The context is the list of existing
 * scenarios and the ten most recent after-action reviews. Side effects:
 * spawns the CLI, appends to the audit log. Never writes a note.
 */
export async function draftNewScenarios(vault: Vault, request: GenerateRequest, day: string, options: DraftOptions = {}): Promise<DraftResult> {
	const library = await loadLibrary(vault);
	const existing = library.scenarios.slice(0, 60).map((s) => `${s.id} (${s.drill}): ${s.situation.replace(/\s+/g, ' ').slice(0, 140)}`);
	const reviews = (await vault.files(AARS, 'md')).sort().reverse().slice(0, 10).map((f) => `${AARS}/${f}`);
	const run = await runDraft<{ scenarios: Drafted[] }>(vault, {
		feature: 'tactics-generate',
		prompt: generatePrompt({ ...request, existing, sources: await gather(vault, reviews) }),
		system: 'You write short decision-training scenarios for one player. Answer only with JSON: {"scenarios":[{"drill":"…","situation":"…","options":["…"],"answer":"…","tags":["…"],"difficulty":2,"time_limit_s":5,"map":"…","why":"…"}]}.',
		schema: GENERATE_SCHEMA,
		paths: reviews,
		note: `${request.count} scenario${request.count === 1 ? '' : 's'} asked for`,
		cli: options.cli
	});
	if (!run.ok) return { ...nothing(run.problem), refusals: run.refusals, destinations: [] };
	const { proposal, dropped } = generateProposal(request, run.value.scenarios, await takenIds(vault), day, run.stamp);
	const destinations = proposal?.edits.map((e) => e.path) ?? [];
	return { proposal, problem: proposal ? null : `None of the ${dropped} drafts read as a scenario. Try again.`, refusals: [], destinations };
}

/* ----------------------------------------------------------- suggest -- */

interface Suggestion {
	situation?: string;
	distractors: string[];
	tags: string[];
	map?: string;
	why?: string;
}

const SUGGEST_SCHEMA: Schema = {
	type: 'object',
	fields: {
		situation: { type: 'string', maxLength: 900 },
		distractors: { type: 'array', maxItems: 3, of: { type: 'string', minLength: 1, maxLength: 200 } },
		tags: { type: 'array', maxItems: 4, of: { type: 'string', minLength: 3, maxLength: 40 } },
		map: { type: 'string', maxLength: 4000 },
		why: { type: 'string', maxLength: 900 }
	},
	optional: ['situation', 'map', 'why']
};

/** The prompt for suggestions on one draft. Pure. */
export function suggestPrompt(scenario: Scenario, note: { path: string; text: string }): string {
	return [
		`Improve this draft training scenario for ${scenario.game === 'ron' ? 'Ready or Not' : scenario.game === 'bodycam' ? 'Bodycam' : 'close-quarters play in both games'}.`,
		'The user wrote it from their own experience: keep their facts and their answer.',
		'',
		'Give:',
		'- situation: the same situation, clearer, second person and present tense, two or three sentences. Omit if it is already clear.',
		CHOICE_DRILLS.includes(scenario.drill)
			? `- distractors: up to ${Math.max(0, Math.min(3, 5 - scenario.options.length))} more wrong options, plausible mistakes a real player makes, none a rewording of an existing option.`
			: '- distractors: none (this drill has no options).',
		`- tags: one to three, dot-namespaced, from: ${TAXONOMY.join(', ')}.`,
		scenario.map || scenario.drill === 'clear-order' ? '- map: omit (it already has one).' : '- map: only if positions matter to the decision.',
		scenario.why ? '- why: omit (the user has written it).' : '- why: two to four sentences on why the answer beats each alternative, as a suggestion for the user to rewrite.',
		'Nothing about weapon stats, patch details or the rules of engagement as fact.',
		'',
		MAP_SPEC,
		'',
		wrapAsData([note])
	].join('\n');
}

/**
 * The suggestion as one proposal: a `revise` of the scenario note, pinned to
 * the bytes read, changing only the Situation, the Options (appended to,
 * never rewritten), the `tags:` line, a new Map and an empty Why (filled as
 * a suggestion). `status:` and the Answer are never touched. Pure. Null when
 * nothing changes or the result would not read as a scenario.
 */
export function suggestProposal(scenario: Scenario, note: { content: string; hash: string }, s: Suggestion, stamp: RunStamp): Proposal | null {
	let text = note.content;
	const changed: string[] = [];

	const situation = s.situation?.trim();
	if (situation && situation !== scenario.situation.trim()) {
		text = setSection(text, 'Situation', situation.replace(/^([ \t]*)#/gm, '$1\\#'));
		changed.push('situation');
	}

	if (CHOICE_DRILLS.includes(scenario.drill)) {
		const have = new Set(scenario.options.map((o) => o.text.toLowerCase()));
		const fresh = s.distractors.map((d) => d.replace(/\s+/g, ' ').trim()).filter((d) => d && !have.has(d.toLowerCase())).slice(0, Math.max(0, 5 - scenario.options.length));
		if (fresh.length) {
			const used = scenario.options.map((o) => o.key.charCodeAt(0));
			const start = Math.max(64, ...used) + 1;
			const lines = fresh.map((d, i) => `- ${String.fromCharCode(start + i)}: ${d}`);
			text = setSection(text, 'Options', [sectionText(text, 'Options') ?? '', ...lines].filter(Boolean).join('\n'), ['Answer']);
			changed.push(`${fresh.length} option${fresh.length === 1 ? '' : 's'}`);
		}
	}

	const tags = cleanTags([...scenario.tags, ...s.tags]);
	if (tags.join(',') !== scenario.tags.join(',')) {
		text = setFrontmatterField(text, 'tags', tags);
		changed.push('tags');
	}

	const map = !scenario.map && scenario.drill !== 'clear-order' ? readMap(s.map) : null;
	if (map) {
		text = setSection(text, 'Map', ['```tactic-map', JSON.stringify(map), '```'].join('\n'), ['Options', 'Answer']);
		changed.push('a map');
	}

	const why = s.why?.trim();
	if (why && !scenario.why) {
		text = setSection(text, 'Why', `> [!suggestion]\n${why.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')}`);
		changed.push('a suggested Why');
	}

	if (!changed.length || text === note.content) return null;
	const read = parseScenario(text, scenario.path);
	if (!read.ok || read.scenario.status !== scenario.status || read.scenario.answers.join('|') !== scenario.answers.join('|')) return null;
	return {
		id: newId('suggest'),
		feature: 'tactics-suggest',
		stamp,
		summary: `For ${scenario.id}: ${changed.join(', ')}.`,
		edits: [
			{
				id: newId('edit'),
				kind: 'revise',
				path: scenario.path,
				text,
				expectedHash: note.hash,
				reason: 'Suggestions for this scenario. Your answer and its status are unchanged.'
			}
		],
		accepted: []
	};
}

/**
 * Draft suggestions for scenario `id`. Only a draft that reads gets them: an
 * approved or retired one is yours as it stands. Side effects: spawns the
 * CLI, appends to the audit log. Never writes a note.
 */
export async function draftSuggestions(vault: Vault, id: string, options: DraftOptions = {}): Promise<DraftResult> {
	const scenario = (await loadLibrary(vault)).scenarios.find((s) => s.id === id);
	if (!scenario) return { ...nothing('There is no such scenario, or it does not read. Fix it first.'), destinations: [] };
	const destinations = [scenario.path];
	if (scenario.status !== 'draft') return { ...nothing('Only a draft gets suggestions. Move it back to draft first.'), destinations };
	const note = await vault.read(scenario.path);
	const run = await runDraft<Suggestion>(vault, {
		feature: 'tactics-suggest',
		prompt: suggestPrompt(scenario, { path: scenario.path, text: note.content }),
		system: 'You improve one draft training scenario. Answer only with JSON: {"situation":"…","distractors":["…"],"tags":["…"],"map":"…","why":"…"}, leaving out what you were told to omit.',
		schema: SUGGEST_SCHEMA,
		paths: [scenario.path],
		note: `suggestions for ${scenario.id}`,
		cli: options.cli
	});
	if (!run.ok) return { ...nothing(run.problem), refusals: run.refusals, destinations };
	const proposal = suggestProposal(scenario, note, run.value, run.stamp);
	return { proposal, problem: proposal ? null : 'Claude had nothing to add that reads as a scenario. Try again.', refusals: [], destinations };
}
