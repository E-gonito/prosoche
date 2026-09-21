/**
 * What a human meant by the three fields a share target receives.
 *
 * Android hands a share over as a GET, and which of `share_title`,
 * `share_text` and `share_url` arrive depends entirely on the app doing the
 * sharing: a browser sends a title and a url, a notes app sends text alone,
 * and some send the url inside the text. One function decides, in its own
 * module rather than beside the load, because SvelteKit allows a
 * `+page.server.ts` only its own exports — and because the shapes real apps
 * send are worth a table test.
 */

/**
 * The three share fields as one line of markdown.
 *
 * Rules, in order: a url that is already inside the text is not repeated; a
 * title that is already inside the text is not repeated; and a title with a
 * url becomes a wikilink-free markdown link, because that is what reads well
 * in the Inbox and what survives a round trip through Obsidian.
 *
 * Exported so the shapes real apps send can be table-tested without a browser.
 */
export function shared(params: URLSearchParams): string {
	const title = (params.get('share_title') ?? '').trim();
	const text = (params.get('share_text') ?? '').trim();
	const url = (params.get('share_url') ?? '').trim() || urlInside(text);

	const body = text === url ? '' : text;
	const label = title && !body.includes(title) ? title : '';

	if (url && label) return body ? `[${label}](${url}) — ${body}` : `[${label}](${url})`;
	if (url) return body && !body.includes(url) ? `${body} ${url}` : body || url;
	return [label, body].filter(Boolean).join(' — ');
}

/** A bare url shared as text, so the link is still treated as a link. */
function urlInside(text: string): string {
	return text.trim().split(/\s+/).length === 1 && /^https?:\/\//.test(text.trim()) ? text.trim() : '';
}
