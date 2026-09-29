/**
 * The browser's side of `/api/glossary`.
 *
 * One call, because every glossary write has the same answer shape: the
 * path written, or why not. Never throws; a lost connection is a result.
 */

import type { ScannedEntry } from '$lib/shared/glossary';

export * from '$lib/shared/glossary';

/** `added` is set by add-scanned: how many entries it wrote. */
export type GlossaryResult = { ok: true; path: string; added?: number } | { ok: false; message: string };

/** `glossary` is the glossary's slug, as in its URL. */
export type GlossaryAction =
	| { action: 'create-glossary'; name: string }
	| { action: 'rename-glossary'; glossary: string; name: string }
	| { action: 'delete-glossary'; glossary: string }
	| { action: 'add'; glossary: string; term: string; category?: string | null; source?: string | null }
	| { action: 'edit'; glossary: string; term: string; change: { term?: string; category?: string; definition?: string; relevance?: string } }
	| { action: 'delete'; glossary: string; term: string }
	| { action: 'set-sources'; glossary: string; sources: string[] }
	/** `complete`: the scan read every note it meant to, so the glossary is marked scanned today. */
	| { action: 'add-scanned'; glossary: string; entries: ScannedEntry[]; complete: boolean }
	/** `study`: a study subject's slug, or '' to stop keeping cards. */
	| { action: 'set-study'; glossary: string; study: string };

/** Send one glossary write. */
export async function glossaryAction(body: GlossaryAction): Promise<GlossaryResult> {
	try {
		const res = await fetch('/api/glossary', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const parsed = await res.json().catch(() => ({}));
		if (res.ok && parsed.ok) return { ok: true, path: parsed.path, added: parsed.added };
		return { ok: false, message: parsed.message ?? `Request failed (${res.status})` };
	} catch {
		return { ok: false, message: 'No connection.' };
	}
}
