/**
 * Writing one card as markdown the card finder reads back as exactly that
 * card: the one door for a glossary's terms into their deck.
 *
 * A card is written in Spaced Repetition's multi-line reversed form, the
 * front, a `??` line, then the back, which is reviewed both ways. Some
 * things a side may hold would change what the finder sees, by the plugin's
 * own rules: a blank line ends a card, so blank lines outside code are
 * dropped; a heading ends it too, so it becomes a bold line; a lone `?` or
 * `??` would be taken for the separator, and a `#word` for a tag, so both
 * are escaped; an unclosed fence would swallow every card after it, so it
 * is closed; and a review comment is removed, since only the line under the
 * card may hold one.
 *
 * Pure. Text in, text out; no filesystem and no clock.
 */

import { scanCards, FLASHCARD_TAG } from './cards';

const FENCE = /^[ \t]*(```|~~~)/;

/**
 * The card with sides `front` and `back`, made safe, as they will read back
 * and as the paragraph that holds it; null when a side is empty once cleaned
 * or the paragraph would not read back as this card. Pure.
 */
export function cardBlock(front: string, back: string): { card: { front: string; back: string }; markdown: string } | null {
	const card = { front: side(front.replace(/\r\n?/g, '\n')), back: side(back.replace(/\r\n?/g, '\n')) };
	if (!card.front || !card.back) return null;
	const markdown = `${card.front}\n??\n${card.back}`;
	const found = scanCards(`#${FLASHCARD_TAG}\n\n${markdown}\n`, 'card.md');
	const readsBack = found.length === 1 && found[0].kind === 'multiline-reversed' && found[0].question === card.front && found[0].answer === card.back;
	return readsBack ? { card, markdown } : null;
}

/**
 * One side of a card as card-safe markdown: review comments dropped, and
 * every line the finder would take for structure rewritten into something
 * it reads as text. Code in a fence is kept exactly.
 */
function side(field: string): string {
	const markdown = field.replace(/ /g, ' ').replace(/<!--(?:SR|fsrs):[\s\S]*?-->/g, '');
	const out: string[] = [];
	let fence: string | null = null;
	for (const raw of markdown.split('\n')) {
		const line = raw.trimEnd();
		const f = FENCE.exec(line);
		if (fence !== null) {
			out.push(line);
			if (f?.[1] === fence) fence = null;
			continue;
		}
		if (f) {
			fence = f[1];
			out.push(line);
			continue;
		}
		const safe = proseLine(line);
		if (safe !== null) out.push(safe);
	}
	// An unclosed fence would swallow every card after this one.
	if (fence !== null) out.push(fence);
	// A rule that separated this card from the next one in the source note
	// separates nothing here.
	while (out[0] === '***') out.shift();
	while (out[out.length - 1] === '***') out.pop();
	return out.join('\n').trim();
}

/**
 * One line of prose made safe inside a card, or null to drop it.
 *
 * - A blank line would end the card, so it goes.
 * - A heading would end it too, so it becomes a bold line.
 * - A lone `?` or `??` would be read as the separator, so it is escaped.
 * - A line of dashes or equals signs would turn the line above into a
 *   heading now the blank line between them is gone, so a rule stays a rule.
 * - A `#word` would become a tag in the vault, so it is escaped. Code spans
 *   keep theirs.
 */
function proseLine(line: string): string | null {
	if (line.trim() === '') return null;
	const heading = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
	if (heading) return heading[1] ? wrap(heading[1].replace(/^\*\*(.*)\*\*$/, '$1'), '**') : null;
	const trimmed = line.trim();
	if (trimmed === '?' || trimmed === '??') return line.replace(/\?/g, '\\?');
	if (/^ {0,3}-{3,}$/.test(line)) return '***';
	if (/^ {0,3}(-+|=+)$/.test(line)) return line.replace(/[-=]/, (c) => `\\${c}`);
	return outsideCode(line, (text) => text.replace(/(^|[\s(])#(?=[A-Za-z])/g, '$1\\#'));
}

/** Apply `fn` to the parts of a line outside inline code spans. */
function outsideCode(line: string, fn: (text: string) => string): string {
	return line
		.split(/(`[^`]*`)/)
		.map((part, i) => (i % 2 === 1 ? part : fn(part)))
		.join('');
}

/** `inner` between two `mark`s, keeping its surrounding space outside them. */
function wrap(inner: string, mark: string): string {
	const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
	return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}
