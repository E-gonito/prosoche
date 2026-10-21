/**
 * Hearing a glossary's words said aloud.
 *
 * A glossary opts in with `pronounce: <code>` in its frontmatter, `tl` for
 * Tagalog: the language code Forvo (native-speaker recordings) files words
 * under. The same code finds a voice in the browser's own speech engine, which
 * tags voices with a region (`fil-PH`), so a code may match several tags. Both
 * halves are pure so the browser and the server agree; the speaking itself is
 * `client/speak.ts`.
 */

/** Other tags a language's voices carry in a browser, by Forvo's code. */
const VOICE_TAGS: Record<string, string[]> = { tl: ['fil', 'tl'], zh: ['zh', 'cmn'] };

/** True for what a glossary may put after `pronounce:`: two or three lower-case letters. Pure. */
export function isLanguageCode(value: unknown): value is string {
	return typeof value === 'string' && /^[a-z]{2,3}$/.test(value);
}

/**
 * Forvo's page for `term` in language `code`, where native speakers have
 * recorded it. Forvo files a phrase under its words joined by underscores.
 * Pure.
 */
export function forvoHref(term: string, code: string): string {
	const word = term.trim().toLowerCase().replace(/\s+/g, '_');
	return `https://forvo.com/word/${encodeURIComponent(word)}/#${code}`;
}

/**
 * The first of `voices` that speaks `code`: a voice whose language tag, such
 * as `fil-PH`, begins with one of the language's tags. Undefined when the
 * device has none. Pure.
 */
export function pickVoice<V extends { lang: string }>(voices: V[], code: string): V | undefined {
	const tags = VOICE_TAGS[code] ?? [code];
	return voices.find((v) => tags.includes(v.lang.toLowerCase().split(/[-_]/)[0]));
}
