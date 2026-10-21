/**
 * URLs and labels the browser and the server both build.
 *
 * A note's URL is written in one place so a wikilink rendered on the server
 * and a link built in a component cannot disagree about encoding.
 */

/** The reading view of a vault-relative note path. */
export function noteHref(path: string): string {
	return `/notes/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * A calendar day relative to today, in words: "today", "yesterday",
 * "3 days ago", or the date itself once it is more than a week back. Both
 * arguments are `YYYY-MM-DD`; days are labels, so this is string arithmetic
 * on the calendar, not on instants.
 */
export function relativeDay(day: string, today: string): string {
	const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
	if (diff === 0) return 'today';
	if (diff === 1) return 'yesterday';
	if (diff === -1) return 'tomorrow';
	if (diff > 1 && diff <= 7) return `${diff} days ago`;
	if (diff < -1 && diff >= -7) return `in ${-diff} days`;
	return day;
}

/** One run of a step's words: plain text, `inline code`, or a [[wikilink]]. */
export type StepPiece = { text: string; code?: true; href?: string };

/**
 * A step's words in pieces, so `inline code` shows as code and a [[wikilink]]
 * as a link rather than as raw punctuation. A link to `Glossaries/<Name>`
 * opens that glossary; any other opens the note. `[[target|label]]` shows its
 * label. Pure.
 */
export function stepPieces(text: string): StepPiece[] {
	return text
		.split(/(`[^`]+`|\[\[[^\]]+\]\])/)
		.filter(Boolean)
		.map((part): StepPiece => {
			if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return { text: part.slice(1, -1), code: true };
			const link = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/.exec(part);
			if (!link) return { text: part };
			const target = link[1].trim().replace(/\.md$/, '');
			const name = target.split('/').pop() ?? target;
			const glossary = /^Glossaries\/[^/]+$/.test(target);
			return { text: link[2]?.trim() || name, href: glossary ? `/glossary/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}` : noteHref(`${target}.md`) };
		});
}
