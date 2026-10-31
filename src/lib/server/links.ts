/**
 * Links: other places worth one click from the rail, such as a Proxmox
 * console or a router's admin page. They live in `_hub/links.md`, one
 * markdown link per list item, so the file reads and clicks the same in
 * Obsidian:
 *
 *     - [Proxmox](https://100.65.91.62:8006)
 *     - [Router](http://10.0.0.1)
 *
 * Anything else in the file (headings, prose, blank lines) is left alone. A
 * list item that looks like a link but is not an `http:` or `https:` one is
 * a mistake, so it is reported rather than quietly dropped.
 */

import { config } from './config';
import type { Link } from '$lib/modules';
import type { Vault } from './vault/index';

export const LINKS_PATH = `${config.hubFolder}/links.md`;

const ITEM = /^\s*[-*+]\s+\[([^\]]+)\]\(([^)\s]+)\)\s*$/;
const LOOKS_LIKE_LINK = /^\s*[-*+]\s+\[[^\]]*\]\(/;

/**
 * The links in a links file, in file order, and a sentence for each list
 * item that starts like a link but is not a well-formed `http(s)` one.
 * Pure.
 */
export function parseLinks(content: string): { links: Link[]; problems: string[] } {
	const links: Link[] = [];
	const problems: string[] = [];
	content.split('\n').forEach((line, i) => {
		if (!LOOKS_LIKE_LINK.test(line)) return;
		const m = ITEM.exec(line);
		const url = m ? URL.parse(m[2]) : null;
		if (m && url && (url.protocol === 'http:' || url.protocol === 'https:')) {
			links.push({ title: m[1].trim(), href: m[2] });
		} else {
			problems.push(`${LINKS_PATH} line ${i + 1} is not a "- [Title](http://…)" link: ${line.trim()}`);
		}
	});
	return { links, problems };
}

/**
 * The links in `_hub/links.md`, plus T3 Code when `HUB_T3_URL` is set. A
 * missing file is no links. Problems go to the log, once per distinct
 * file content, so a bad line is seen without flooding it on every page.
 */
export async function links(vault: Vault): Promise<Link[]> {
	const { content } = await vault.read(LINKS_PATH);
	const parsed = parseLinks(content);
	if (parsed.problems.length && content !== lastReported) {
		lastReported = content;
		for (const problem of parsed.problems) console.warn(`[links] ${problem}`);
	}
	return config.t3Url ? [...parsed.links, { title: 'T3 Code', href: config.t3Url }] : parsed.links;
}

let lastReported = '';
