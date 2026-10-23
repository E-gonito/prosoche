/**
 * The bridge script: the one piece of prosoche's own code that runs inside a
 * book's frame. `chapter.ts` injects it into every HTML page it serves.
 *
 * What it does is written beside the code, in `bridge-frame.ts`. In short:
 *  - before any of the book's scripts run, it replaces `localStorage` and
 *    `sessionStorage` (which throw in the frame's opaque origin) with
 *    in-memory copies, seeded from `window.__prosocheStorage`, and reports
 *    changes to `localStorage` upward;
 *  - it reports `ready`, the `place` as the page scrolls, and the `selection`;
 *  - it obeys `goto`, `mark` and `style` from the reader.
 *
 * It trusts only messages from `window.parent` carrying `BRIDGE_SOURCE`, and
 * posts to it with target origin `*`, because an opaque-origin frame cannot
 * name its parent's origin; the reader checks `event.source` instead.
 */

import { frameMain, makeStorage, matchSegments } from './bridge-frame';

/**
 * The bridge as JavaScript source: an immediately-invoked function with no
 * imports, in ES2020, ASCII only, safe to put between `<script>` tags or in
 * CDATA (it holds no `</script`, `<!--` or `]]>`). The same text every time.
 */
export function bridgeScript(): string {
	const parts = [makeStorage, matchSegments, frameMain].map((f) => f.toString());
	return `(function () {\n'use strict';\n${parts.join('\n')}\nframeMain(window, document);\n})();`;
}
