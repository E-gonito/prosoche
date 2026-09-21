/**
 * Markdown to HTML for reading a note in the hub.
 *
 * Obsidian's dialect is markdown plus wikilinks, so those are rewritten to
 * ordinary links before `marked` sees them. Everything else is left to marked,
 * including raw HTML, which some notes rely on.
 *
 * This is the reading view only. Editing goes through CodeMirror in the
 * browser and never through here, which is why nothing in this file has to
 * round-trip: it may throw away whatever it likes as long as the note on disk
 * is untouched.
 */

import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

const WIKILINK = /(!?)\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

/**
 * Render a note body. `resolve` maps a wikilink target to a URL, or returns
 * null for a link with no matching note, which is then shown as an unresolved
 * link rather than a broken one.
 */
export function renderMarkdown(body: string, resolve: (target: string) => string | null = () => null): string {
	const withLinks = body.replace(WIKILINK, (_match, bang, target, heading, alias) => {
		const label = alias ?? (heading ? `${target} › ${heading}` : target);
		const href = resolve(String(target).trim());
		if (bang === '!') return href ? `[${label}](${href})` : `\`![[${target}]]\``;
		return href ? `[${label}](${href})` : `<span class="wl-missing" title="No note called ${escapeAttr(target)}">${escapeHtml(label)}</span>`;
	});
	return marked.parse(withLinks, { async: false });
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}
function escapeAttr(s: string): string {
	return escapeHtml(s).replace(/"/g, '&quot;');
}
