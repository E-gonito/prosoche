/**
 * After-action reviews: a failure from a real session, written down, and
 * the draft scenario it becomes.
 *
 * An AAR is one note in `Tactics/AAR/`, in the style of the vault's other
 * templates (bold `**Label:**` lines, then `###` sections), and
 * `Tactics/AAR Template.md` is the same note with its blanks showing, for
 * writing one in Obsidian. The form on the AAR page writes both the review
 * and its scenario: `provenance: own-aar`, `status: draft`, a `source:`
 * linking back to the review, and two options from your own words, what you
 * did and what you should have done, the second the answer. The Why is left
 * for you; Suggest on the scenario's page can draft more options, a map and
 * tags, and even a Why, but only as a proposal you accept.
 *
 * Nothing here calls a model.
 */

import { CHOICE_DRILLS, GAMES, type DrillKind, type Game } from '$lib/shared/tactics';
import { AARS, AAR_TEMPLATE, SCENARIOS } from './paths';
import { scenarioNote } from '../parse/scenario';
import { loadLibrary } from './index';
import type { Vault } from '../vault/index';

const GAME_LABEL: Record<Game, string> = { ron: 'Ready or Not', bodycam: 'Bodycam', shared: 'Both' };
const ID_PREFIX: Record<Game, string> = { ron: 'ron', bodycam: 'bc', shared: 'cqb' };
const DEFAULT_DRILL: Record<Game, DrillKind> = { ron: 'threat-call', bodycam: 'hold-peek', shared: 'hold-peek' };
const TAG = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const MAX_TEXT = 2000;

/** What one review says. */
export interface Aar {
	day: string;
	game: Game;
	map: string;
	happened: string;
	did: string;
	should: string;
	tags: string[];
	/** The scenario it became, by id. */
	scenario?: string;
}

/**
 * An AAR note, or with `null` the template: the same lines with their
 * blanks showing. Pure.
 */
export function aarNote(aar: Aar | null): string {
	const v = (text: string | undefined, blank: string) => (aar ? safe(text ?? '') : blank);
	return [
		'## After-action review',
		'',
		`**Date:** ${aar ? aar.day : 'YYYY-MM-DD'}`,
		`**Game:** ${aar ? GAME_LABEL[aar.game] : '[Ready or Not / Bodycam]'}`,
		`**Map / mission:** ${v(aar?.map, '[Map, and mode or mission]')}`,
		`**Scenario:** ${aar?.scenario ? `[[${aar.scenario}]]` : aar ? 'none yet' : '[filled in when prosoche makes one]'}`,
		'',
		'### What happened',
		v(aar?.happened, '[The moment it went wrong, as you saw it: where you were, what you knew.]'),
		'',
		'### What I did',
		v(aar?.did, '[Your decision, in a line.]'),
		'',
		'### What I should have done',
		v(aar?.should, '[The better decision, in a line.]'),
		'',
		'### Tags',
		aar ? aar.tags.join(', ') : '[cqb.corner, bc.peek, …]',
		''
	].join('\n');
}

/** The draft scenario an AAR becomes: two options in your words, the second the answer. `source` is the review's note name. Pure. */
export function aarScenario(aar: Aar & { scenario: string }, drill: DrillKind, source: string): string {
	return scenarioNote({
		id: aar.scenario,
		game: aar.game,
		drill,
		tags: aar.tags,
		difficulty: 2,
		timeLimitS: 5,
		provenance: 'own-aar',
		source: `[[${source}]]`,
		created: aar.day,
		situation: aar.happened,
		map: null,
		options: [aar.did, aar.should],
		answer: 'B',
		why: '',
		whySuggested: false
	});
}

/** The first `<prefix>-NNNN` not in `taken`, counting from one. Pure. */
export function nextId(game: Game, taken: ReadonlySet<string>): string {
	for (let n = 1; ; n++) {
		const id = `${ID_PREFIX[game]}-${String(n).padStart(4, '0')}`;
		if (!taken.has(id)) return id;
	}
}

type Refusal = { ok: false; reason: string; message: string };

/**
 * Write an AAR and the draft scenario it becomes, from the form's untrusted
 * `body`: `{ game, map, happened, did, should, tags, drill? }`.
 *
 * Refuses `invalid`, writing nothing, for a missing or overlong field, a did
 * and a should that are the same, no tags or a tag that is not
 * dot-namespaced lower case, or a drill that is not a choice drill. The
 * review is `Tactics/AAR/<day> <map>.md`, numbered when that name is taken;
 * the scenario takes the next free id for its game (`bc-0001`, `ron-0001`,
 * `cqb-0001`), counting ids in notes that do not read as taken too. Neither
 * write overwrites a note. Answers both paths and the id.
 */
export async function recordAar(
	vault: Vault,
	body: Record<string, unknown>,
	day: string
): Promise<{ ok: true; aarPath: string; scenarioPath: string; id: string } | Refusal> {
	const bad = (message: string): Refusal => ({ ok: false, reason: 'invalid', message });
	const game = GAMES.find((g) => g === body.game);
	if (!game) return bad('Choose the game.');
	const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string).trim() : '');
	const [map, happened, did, should] = ['map', 'happened', 'did', 'should'].map(text);
	if (!happened || !did || !should) return bad('Say what happened, what you did and what you should have done.');
	if ([map, happened, did, should].some((t) => t.length > MAX_TEXT)) return bad(`Keep each field under ${MAX_TEXT} characters.`);
	if (oneLine(did).toLowerCase() === oneLine(should).toLowerCase()) return bad('What you did and what you should have done are the same.');
	const tags = [...new Set((Array.isArray(body.tags) ? body.tags : []).filter((t): t is string => typeof t === 'string').map((t) => t.trim().toLowerCase()))];
	if (!tags.length || tags.length > 6) return bad('Give between one and six tags.');
	const wrong = tags.find((t) => !TAG.test(t));
	if (wrong) return bad(`"${wrong}" is not a tag like cqb.corner.`);
	const drill = body.drill === undefined ? DEFAULT_DRILL[game] : CHOICE_DRILLS.find((d) => d === body.drill);
	if (!drill) return bad('The drill is threat-call, hold-peek or squad-command.');

	const id = nextId(game, await takenIds(vault));

	const name = await freeAarName(vault, `${day} ${fileSafe(map) || 'Session'}`);
	const aar: Aar = { day, game, map, happened, did, should, tags, scenario: id };
	const aarPath = `${AARS}/${name}.md`;
	const scenarioPath = `${SCENARIOS}/${id}.md`;
	const wroteAar = await vault.write(aarPath, aarNote(aar), '');
	if (!wroteAar.ok) return { ok: false, reason: 'conflict', message: 'A review with that name appeared meanwhile. Try again.' };
	const wroteScenario = await vault.write(scenarioPath, aarScenario({ ...aar, scenario: id }, drill, name), '');
	if (!wroteScenario.ok) return { ok: false, reason: 'conflict', message: `The review is saved, but ${id} appeared meanwhile. Try again.` };
	// The template for writing one by hand in Obsidian; a clash means it exists already.
	await vault.write(AAR_TEMPLATE, aarNote(null), '');
	return { ok: true, aarPath, scenarioPath, id };
}

/**
 * Every scenario id in use: those of the notes that read, those that do
 * not but name one, and every file name, so a new id never lands on a note
 * that is midway through being fixed. Reads the vault only.
 */
export async function takenIds(vault: Vault): Promise<Set<string>> {
	const library = await loadLibrary(vault);
	const files = (await vault.files(SCENARIOS, 'md', { deep: true })).map((f) => f.split('/').pop()!.slice(0, -3));
	return new Set([...library.scenarios.map((s) => s.id), ...library.problems.flatMap((p) => (p.id ? [p.id] : [])), ...files]);
}

async function freeAarName(vault: Vault, base: string): Promise<string> {
	for (let n = 1; ; n++) {
		const name = n === 1 ? base : `${base} ${n}`;
		if (!(await vault.read(`${AARS}/${name}.md`)).exists) return name;
	}
}

/** A map name safe as a file name and a wikilink. */
function fileSafe(text: string): string {
	return oneLine(text).replace(/[/\\:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').replace(/^\.+|\.+$/g, '').trim().slice(0, 60);
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** Free text made safe to sit under a heading: a line starting `#` would become one. */
function safe(text: string): string {
	return text.trim().replace(/^([ \t]*)#/gm, '$1\\#');
}
