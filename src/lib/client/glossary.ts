/**
 * The browser's side of `/api/glossary`.
 *
 * One call, because both glossary writes have the same answer shape: the
 * path written, or why not. Never throws; a lost connection is a result.
 */

export type GlossaryResult = { ok: true; path: string } | { ok: false; message: string };

export type GlossaryAction =
	| { action: 'start'; slug: string }
	| { action: 'add'; slug: string; term: string; category?: string | null; source?: string | null };

/** Send one glossary write. */
export async function glossaryAction(body: GlossaryAction): Promise<GlossaryResult> {
	try {
		const res = await fetch('/api/glossary', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const parsed = await res.json().catch(() => ({}));
		if (res.ok && parsed.ok) return { ok: true, path: parsed.path };
		return { ok: false, message: parsed.message ?? `Request failed (${res.status})` };
	} catch {
		return { ok: false, message: 'No connection.' };
	}
}
