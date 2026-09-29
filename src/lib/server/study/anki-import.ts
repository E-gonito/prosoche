/**
 * Importing Anki decks: one exported `.txt` deck in, one markdown card file
 * out.
 *
 * The export side of this is `anki.ts`, which documents the format. The user's
 * eighty decks under `Flashcards/` were exported from Obsidian notes, so an
 * answer is markdown wearing HTML: newlines written as `&lt;br&gt;`, code in
 * `<pre>` with real `<br>`s, `**bold**` left as it was, and now and then a
 * review comment that came along for the ride.
 *
 *     #separator:Tab
 *     #html:true
 *     #deck:CS::Networking
 *     #tags:CS Networking
 *
 *     What is HTTP?<TAB>Hyper Text Transfer Protocol&lt;br&gt;<pre>GET /<br>200 OK</pre>
 *
 * becomes one note in Spaced Repetition's syntax:
 *
 *     ---
 *     goal:
 *     source: Flashcards/Computer Science/Networking/HTTP.txt
 *     ---
 *
 *     #flashcards/cs/networking
 *
 *     What is HTTP?
 *     ?
 *     Hyper Text Transfer Protocol
 *     ```
 *     GET /
 *     200 OK
 *     ```
 *
 * The card grammar is not repeated here. `flashcards.ts` owns it, and every
 * card this writes is first read back through `scanCards`: a card whose text
 * the finder would read differently is written in the other form, and one
 * that fits neither is left out and reported. So "the import produced a card
 * Obsidian reads differently" is checked on every card, not hoped for.
 *
 * What cannot be kept, by the plugin's own rules: a blank line inside a card
 * ends it, so blank lines outside code are dropped; a heading would end it
 * too, so a heading becomes a bold line. Review history is not carried over.
 *
 * Pure. Text in, text out; no filesystem and no clock.
 */

import { scanCards, FLASHCARD_TAG, type CardKind } from './flashcards';

/** One card, both sides as markdown exactly as the card finder reads them back. */
export interface AnkiCard {
	front: string;
	back: string;
}

/** One deck file, read. */
export interface AnkiDeckFile {
	/** Anki deck name, `::` separated, from `#deck:` or else the file's path. */
	deck: string;
	/** Tags from `#tags:`, as Anki wrote them. Returned, never written. */
	tags: string[];
	/** Every card that will be written, in file order. */
	cards: AnkiCard[];
	/** Human-readable notes on anything skipped or guessed, each said once. */
	problems: string[];
}

/** Anki's names for its separators, as `#separator:` writes them. */
const SEPARATORS: Record<string, string> = {
	tab: '\t',
	comma: ',',
	semicolon: ';',
	space: ' ',
	pipe: '|',
	colon: ':'
};

const FENCE = /^[ \t]*(```|~~~)/;

/**
 * Read one Anki text export.
 *
 * `text` is the file's content and `source` its vault-relative path, used only
 * to name a deck whose file has no `#deck:` header. Honours the headers Anki
 * writes (`#separator:`, `#html:`, `#deck:`, `#tags:`, and any `#… column:`
 * header, whose column is then not taken for a side), quoted fields with
 * doubled quotes and embedded newlines, and blank lines between rows.
 *
 * A row with no answer, a card whose side is empty once converted, and a card
 * the finder would not read back as written are skipped and reported. Extra
 * columns are ignored and reported once per deck. Never throws.
 */
export function parseAnkiDeck(text: string, source: string): AnkiDeckFile {
	const headers = new Map<string, string>();
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	let at = 0;
	while (at < lines.length && lines[at].startsWith('#')) {
		const m = /^#([^:]+):(.*)$/.exec(lines[at]);
		if (m) headers.set(m[1].trim().toLowerCase(), m[2].trim());
		at++;
	}

	const problems: string[] = [];
	const named = headers.get('separator') ?? 'tab';
	const separator = SEPARATORS[named.toLowerCase()] ?? (named.length === 1 ? named : null);
	if (separator === null) problems.push(`Unknown separator "${named}"; read as tabs.`);
	const html = (headers.get('html') ?? 'true').toLowerCase() !== 'false';
	const deck = headers.get('deck') || source.replace(/^Flashcards\//, '').replace(/\.txt$/, '').split('/').join('::');
	const tags = (headers.get('tags') ?? '').split(/\s+/).filter(Boolean);

	// A `#notetype column:1` or `#tags column:3` header takes that column away
	// from the sides; front and back are the first two columns left.
	const reserved = new Set(
		[...headers].filter(([key]) => key.endsWith(' column')).map(([, value]) => Number(value) - 1)
	);
	const sides = [0, 1, 2, 3, 4, 5].filter((c) => !reserved.has(c)).slice(0, 2);

	const cards: AnkiCard[] = [];
	let extra = 0;
	for (const row of rows(lines.slice(at).join('\n'), separator ?? '\t', at)) {
		if (row.fields.every((f) => f.trim() === '')) continue;
		if (row.fields.length > 2 + reserved.size) extra++;
		const rawFront = row.fields[sides[0]] ?? '';
		const rawBack = row.fields[sides[1]];
		if (rawBack === undefined) {
			problems.push(`Line ${row.line}: no answer column; skipped.`);
			continue;
		}
		const card = { front: side(rawFront, html), back: side(rawBack, html) };
		if (!card.front || !card.back) {
			problems.push(`Line ${row.line}: ${card.front ? 'the answer' : 'the question'} is empty; skipped.`);
			continue;
		}
		if (cardMarkdown(card) === null) {
			problems.push(`Line ${row.line}: would not read back as the same card; skipped.`);
			continue;
		}
		cards.push(card);
	}
	if (extra) problems.push(`${extra} ${extra === 1 ? 'row has' : 'rows have'} more than two columns; only the first two were kept.`);

	return { deck, tags, cards, problems };
}

/**
 * The markdown card file for one deck.
 *
 * Frontmatter with `goal:` left empty for the author to set and `source:`
 * naming the `.txt` it came from; the deck's `#flashcards/<deck>` tag on its
 * own line, which is what makes the plugin, and prosoche, read the file's
 * cards; then each card as its own paragraph, inline `front::back` when that
 * reads back unchanged and the multiline `?` form otherwise. No review
 * comments: every card starts new.
 *
 * Pure. Writes only the cards in `file.cards`, so a caller that reports
 * `file.cards.length` reports exactly what the note holds.
 */
export function deckNote(file: AnkiDeckFile, source: string): string {
	const blocks = file.cards.map((card) => cardMarkdown(card)).filter((block): block is string => block !== null);
	return ['---', 'goal:', `source: ${yamlString(source)}`, '---', '', `#${deckTag(file.deck)}`, '', ...blocks.flatMap((b) => [b, ''])].join(
		'\n'
	);
}

/**
 * The tag an imported deck carries, without `#`: `CS::Cyber Security` is
 * `flashcards/cs/cyber-security`. Each `::` level is a nested tag, so decks
 * group in Obsidian's tag pane as they did in Anki. Pure.
 */
export function deckTag(deck: string): string {
	const parts = deck
		.split('::')
		.map((part) => part.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
		.filter(Boolean);
	return [FLASHCARD_TAG, ...parts].join('/');
}

/**
 * A card as the paragraph that holds it, or null when no form reads back as
 * this card. Inline is tried first because it is what a person would write,
 * but only when its `::` is the only one on the line: `a::std::io` reads back
 * correctly, and still leaves a person, or another reader, guessing.
 */
function cardMarkdown(card: AnkiCard): string | null {
	const inline = `${card.front}::${card.back}`;
	const forms: Array<[string, CardKind]> = [
		...(inline.split('::').length === 2 ? [[inline, 'inline'] as [string, CardKind]] : []),
		[`${card.front}\n?\n${card.back}`, 'multiline']
	];
	return forms.find(([block, kind]) => readsBackAs(block, kind, card))?.[0] ?? null;
}

/** Whether the card finder reads `block` as exactly this one card, of this kind. */
function readsBackAs(block: string, kind: CardKind, card: AnkiCard): boolean {
	const found = scanCards(`#${FLASHCARD_TAG}\n\n${block}\n`, 'import.md');
	return found.length === 1 && found[0].kind === kind && found[0].question === card.front && found[0].answer === card.back;
}

/**
 * One side of a card as card-safe markdown: HTML converted, review comments
 * dropped, and every line the finder would take for structure rewritten into
 * something it reads as text. Code in a fence is kept exactly.
 */
function side(field: string, html: boolean): string {
	const markdown = (html ? htmlToMarkdown(field) : field).replace(/ /g, ' ').replace(/<!--SR:[\s\S]*?-->/g, '');
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

/**
 * Anki's HTML as markdown.
 *
 * `<br>` and the escaped `&lt;br&gt;` these exports use for a newline both
 * become one; `<b>`, `<i>`, `<s>` and `<code>` their markdown marks; lists,
 * paragraphs and divs lines; `<a>` a link; `<img>` an image link; `<pre>` a
 * fenced block. Entities are decoded and any other tag is dropped, keeping
 * its text. Anything else that looks like markup was escaped in the export,
 * so it is text, and stays text.
 */
export function htmlToMarkdown(html: string): string {
	const source = html.replace(/&lt;br\s*\/?&gt;/gi, '<br>').replace(/&lt;!--SR:[\s\S]*?--&gt;/g, '');
	const stack: Frame[] = [{ tag: '', attrs: '', out: '', items: 0 }];
	const top = () => stack[stack.length - 1];
	const inPre = () => stack.some((f) => f.tag === 'pre');

	const close = () => {
		const frame = stack.pop()!;
		const parent = top();
		parent.out += render(frame, parent, stack);
	};

	const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[\s/][^>]*)?)>/g;
	let last = 0;
	for (let m = TOKEN.exec(source); m; m = TOKEN.exec(source)) {
		top().out += decode(source.slice(last, m.index), inPre());
		last = m.index + m[0].length;
		if (!m[2]) continue;
		const tag = m[2].toLowerCase();
		const attrs = m[3] ?? '';
		if (m[1]) {
			const at = stack.map((f) => f.tag).lastIndexOf(tag);
			if (at > 0) while (stack.length > at) close();
			continue;
		}
		if (tag === 'br') top().out += '\n';
		else if (tag === 'img') top().out += image(attrs);
		else if (tag === 'hr') top().out += '\n***\n';
		else if (!VOID.has(tag) && !attrs.trimEnd().endsWith('/')) {
			// `<li>` closes an open `<li>` before it, as HTML says it does.
			if (tag === 'li' && top().tag === 'li') close();
			stack.push({ tag, attrs, out: '', items: 0 });
		}
	}
	top().out += decode(source.slice(last), inPre());
	while (stack.length > 1) close();
	return stack[0].out;
}

const VOID = new Set(['area', 'base', 'col', 'embed', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** One closed element, as the markdown its parent gets. */
function render(frame: Frame, parent: Frame, stack: Frame[]): string {
	const inner = frame.out;
	const pre = stack.some((f) => f.tag === 'pre');
	switch (frame.tag) {
		case 'b':
		case 'strong':
			return pre ? inner : wrap(inner, '**');
		case 'i':
		case 'em':
			return pre ? inner : wrap(inner, '*');
		case 's':
		case 'strike':
		case 'del':
			return pre ? inner : wrap(inner, '~~');
		case 'code':
			return pre || !inner.trim() ? inner : `\`${inner}\``;
		case 'a': {
			const href = attr(frame.attrs, 'href');
			return href && inner.trim() && !pre ? `[${inner.trim()}](${href})` : inner;
		}
		case 'p':
		case 'div':
		case 'tr':
			return `\n${inner}\n`;
		case 'td':
		case 'th':
			return ` ${inner.trim()} `;
		case 'h1':
		case 'h2':
		case 'h3':
		case 'h4':
		case 'h5':
		case 'h6':
			return `\n${wrap(inner.trim(), '**')}\n`;
		case 'ul':
		case 'ol':
			return `\n${inner.replace(/^\n+|\n+$/g, '')}\n`;
		case 'li': {
			const marker = parent.tag === 'ol' ? `${++parent.items}. ` : '- ';
			const body = inner.replace(/^\n+|\n+$/g, '').replace(/\n+/g, '\n');
			return `\n${marker}${body.split('\n').join(`\n${' '.repeat(marker.length)}`)}`;
		}
		case 'pre': {
			const code = inner.replace(/^\n+|\n+$/g, '');
			const fence = /^[ \t]*```/m.test(code) ? '~~~' : '```';
			return `\n${fence}\n${code}\n${fence}\n`;
		}
		case 'script':
		case 'style':
			return '';
		default:
			return inner;
	}
}

/** An open element while converting: its tag, attributes, the markdown so far and, for `<ol>`, items seen. */
interface Frame {
	tag: string;
	attrs: string;
	out: string;
	items: number;
}

/** `**text**`, with any space just inside the marks moved outside them. */
function wrap(inner: string, mark: string): string {
	const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
	return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}

/** An `<img>` as a markdown image, or nothing when it names no source. */
function image(attrs: string): string {
	const src = attr(attrs, 'src');
	if (!src) return '';
	return `![${attr(attrs, 'alt') ?? ''}](${src.includes(' ') ? `<${src}>` : src})`;
}

/** One attribute's decoded value, quoted or not, or null. */
function attr(attrs: string, name: string): string | null {
	const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
	return m ? decode(m[1] ?? m[2] ?? m[3], true) : null;
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”',
	times: '×',
	rarr: '→',
	larr: '←',
	copy: '©'
};

/**
 * HTML entities decoded. Outside a `<pre>`, raw newlines are dropped as HTML
 * drops them; inside one they are the code's own.
 */
function decode(text: string, keepNewlines: boolean): string {
	const flat = keepNewlines ? text : text.replace(/\n/g, ' ');
	return flat.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
		if (name[0] === '#') {
			const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
		}
		return ENTITIES[name.toLowerCase()] ?? whole;
	});
}

/**
 * The rows of a deck body, split on `separator`, honouring Anki's quoting: a
 * field that starts with `"` runs to the next lone `"`, and may hold the
 * separator, newlines and `""` for a quote. `first` is the file line the body
 * starts on, so a problem can name the line a person would look at.
 */
function rows(body: string, separator: string, first: number): Array<{ line: number; fields: string[] }> {
	const out: Array<{ line: number; fields: string[] }> = [];
	let line = first + 1;
	let i = 0;
	while (i < body.length) {
		const start = line;
		const fields: string[] = [];
		for (;;) {
			let field = '';
			if (body[i] === '"') {
				i++;
				for (; i < body.length; i++) {
					if (body[i] === '"') {
						if (body[i + 1] === '"') {
							field += '"';
							i++;
						} else {
							i++;
							break;
						}
					} else {
						if (body[i] === '\n') line++;
						field += body[i];
					}
				}
				// Anything between the closing quote and the separator is kept,
				// as a lenient reader would, rather than lost.
				while (i < body.length && body[i] !== separator && body[i] !== '\n') field += body[i++];
			} else {
				while (i < body.length && body[i] !== separator && body[i] !== '\n') field += body[i++];
			}
			fields.push(field);
			if (body[i] === separator) {
				i++;
				continue;
			}
			break;
		}
		if (body[i] === '\n') {
			i++;
			line++;
		}
		out.push({ line: start, fields });
	}
	return out;
}

/** `value` as a YAML scalar: plain when it is plainly a path, quoted otherwise. */
function yamlString(value: string): string {
	return /^[\w][\w ./()',&+-]*$/.test(value) && !/\s$/.test(value) ? value : JSON.stringify(value);
}
