/**
 * The browser's side of `/api/meetings`.
 *
 * One call, because every notebook write has the same answer shape: the
 * path written, or why not. Never throws; a lost connection is a result.
 */

export type MeetingResult = { ok: true; path: string } | { ok: false; message: string };

export type MeetingAction =
	| { action: 'assign'; title: string; slug: string }
	| { action: 'start'; slug: string; type: 'meeting' | 'standup'; title: string; event?: string | null; attendees?: string[] }
	| { action: 'capture'; slug: string; path: string; kind: string; text: string; guess?: string }
	| { action: 'end'; slug: string; path: string };

/** Send one notebook write. */
export async function meetingAction(body: MeetingAction): Promise<MeetingResult> {
	try {
		const res = await fetch('/api/meetings', {
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
