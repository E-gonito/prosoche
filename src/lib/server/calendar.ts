/**
 * Google Calendar, read through its private "secret address in iCal format"
 * URL. No OAuth: the URL itself is the credential, so it is never logged and
 * never returned to a caller.
 *
 * `node-ical` does the RFC 5545 work — RRULE expansion via `rrule-temporal`,
 * EXDATE filtering, RECURRENCE-ID overrides, and TZID-to-UTC conversion — so
 * this file only has to decide what a "day" and a "minute" mean to the rest
 * of the hub, and to turn network failure into a status rather than a throw.
 *
 * Two callers (Today, Meetings) share this module rather than each fetching
 * and parsing their own feed, so the ICS grammar and the feed cache exist in
 * exactly one place.
 */

import { sync, expandRecurringEvent } from 'node-ical';
import type { CalendarResponse, EventInstance, ParameterValue, VEvent } from 'node-ical';
import { config } from './config';

export interface CalendarEvent {
	/** Stable per occurrence: the ICS UID plus the occurrence's start date, e.g. `abc123@google.com/2026-09-29`. */
	id: string;
	title: string;
	/** YYYY-MM-DD, local time. */
	day: string;
	/** Minutes since local midnight; null for an all-day event. */
	startMin: number | null;
	endMin: number | null;
	location: string;
	description: string;
	/** Attendee display names (or emails when no name), organiser excluded. */
	attendees: string[];
	/** A video-call link found in the event (Meet/Zoom/Teams) or '' */
	link: string;
}

type CalendarResult =
	| { ok: true; events: CalendarEvent[] }
	| { ok: false; reason: 'not-configured' | 'unreachable'; message: string };

/** How long a fetch is allowed to hang before the feed counts as unreachable. */
const FETCH_TIMEOUT_MS = 10_000;

/** The last feed fetched, kept so a failed refetch can still serve something. */
let cache: { url: string; text: string; fetchedAt: number } | null = null;

/**
 * Events whose day falls in [from, to] inclusive (YYYY-MM-DD), sorted by day
 * then start (all-day first). Never throws.
 *
 * Fetches the URL in `config.calendar.icsUrl`, reusing the last successful
 * fetch for `config.calendar.cacheTtlMs` before asking again. A fetch that
 * fails after that falls back to the stale copy if one exists; only an empty
 * URL or a first fetch with nothing to fall back on produces `not-configured`
 * or `unreachable`. `opts.fetchImpl` and `opts.now` exist so a test can supply
 * a stub feed and control the clock without touching the network or a timer.
 */
export async function eventsBetween(
	from: string,
	to: string,
	opts: { fetchImpl?: typeof fetch; now?: Date } = {}
): Promise<CalendarResult> {
	const url = config.calendar.icsUrl.trim();
	if (!url) {
		return { ok: false, reason: 'not-configured', message: 'No Google Calendar address is set (HUB_GCAL_ICS).' };
	}

	const now = (opts.now ?? new Date()).getTime();
	const doFetch = opts.fetchImpl ?? fetch;
	const isFresh = cache !== null && cache.url === url && now - cache.fetchedAt < config.calendar.cacheTtlMs;

	if (isFresh && cache) return { ok: true, events: parseIcs(cache.text, from, to) };

	const fetched = await fetchIcs(url, doFetch);
	if (fetched.ok) {
		cache = { url, text: fetched.text, fetchedAt: now };
		return { ok: true, events: parseIcs(fetched.text, from, to) };
	}
	if (cache && cache.url === url) return { ok: true, events: parseIcs(cache.text, from, to) };
	return { ok: false, reason: 'unreachable', message: fetched.message };
}

/** One timed-out, never-throwing fetch of the raw feed text. */
async function fetchIcs(
	url: string,
	doFetch: typeof fetch
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await doFetch(url, { signal: controller.signal });
		if (!response.ok) return { ok: false, message: `The calendar feed answered with ${response.status}.` };
		return { ok: true, text: await response.text() };
	} catch (e) {
		return { ok: false, message: `Could not reach the calendar feed: ${reason(e)}.` };
	} finally {
		clearTimeout(timer);
	}
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Pure: parse ICS text into occurrences within [from, to]. Exported for
 * tests. A malformed feed, a malformed event or a rule `node-ical` cannot
 * expand is dropped rather than thrown; the rest of the feed still renders.
 *
 * A multi-day timed event (its end on a later calendar day than its start)
 * produces one occurrence, on the start day, with `endMin` clamped to the
 * end of that day — kept simple rather than splitting it across days.
 */
export function parseIcs(ics: string, from: string, to: string): CalendarEvent[] {
	const { from: fromDate, to: toDate } = dayBounds(from, to);

	let data: CalendarResponse;
	try {
		data = sync.parseICS(ics);
	} catch {
		return [];
	}

	const events: CalendarEvent[] = [];
	for (const component of Object.values(data)) {
		if (!component || component.type !== 'VEVENT') continue;
		const master = component as VEvent;

		let instances: EventInstance[];
		try {
			instances = expandRecurringEvent(master, { from: fromDate, to: toDate });
		} catch {
			continue;
		}

		for (const instance of instances) {
			const event = toCalendarEvent(master.uid, instance);
			if (event) events.push(event);
		}
	}

	return events.sort(compareEvents);
}

/** [from, to] as local-time bounds `expandRecurringEvent` can search within. */
function dayBounds(from: string, to: string): { from: Date; to: Date } {
	const [fy, fm, fd] = from.split('-').map(Number);
	const [ty, tm, td] = to.split('-').map(Number);
	return {
		from: new Date(fy, fm - 1, fd, 0, 0, 0, 0),
		to: new Date(ty, tm - 1, td, 23, 59, 59, 999)
	};
}

function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
	if (a.day !== b.day) return a.day < b.day ? -1 : 1;
	const allDayDiff = Number(a.startMin === null ? 0 : 1) - Number(b.startMin === null ? 0 : 1);
	if (allDayDiff !== 0) return allDayDiff;
	return (a.startMin ?? 0) - (b.startMin ?? 0);
}

/** One occurrence, or null for a cancelled one (base event or override). */
function toCalendarEvent(uid: string, instance: EventInstance): CalendarEvent | null {
	const event = instance.event;
	if (event.status === 'CANCELLED') return null;

	const day = formatDay(instance.start);
	return {
		id: `${uid}/${day}`,
		title: textValue(event.summary) || textValue(instance.summary) || '(untitled)',
		day,
		startMin: instance.isFullDay ? null : minutesOfDay(instance.start),
		endMin: instance.isFullDay ? null : endMinutesOf(instance.start, instance.end),
		location: textValue(event.location),
		description: textValue(event.description),
		attendees: attendeesOf(event),
		link: linkOf(event)
	};
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** Local calendar day, so a `Z` or TZID time already converted to local by
 * `node-ical` reads as the day the user would see on their clock. */
function formatDay(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function minutesOfDay(date: Date): number {
	return date.getHours() * 60 + date.getMinutes();
}

/** The end time-of-day, clamped to midnight when the event runs past its start day. */
function endMinutesOf(start: Date, end: Date): number {
	return formatDay(end) === formatDay(start) ? minutesOfDay(end) : 24 * 60;
}

/** A property value that may carry ICS parameters (e.g. `SUMMARY;LANGUAGE=de:`). */
function textValue(value: ParameterValue<string> | undefined): string {
	if (value === undefined) return '';
	return typeof value === 'string' ? value : (value.val ?? '');
}

function toList<T>(value: T | T[] | undefined): T[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

function emailOf(value: ParameterValue<string, Record<string, unknown>> | undefined): string {
	if (value === undefined) return '';
	const raw = typeof value === 'string' ? value : value.val;
	return raw.replace(/^mailto:/i, '').trim().toLowerCase();
}

function displayNameOf(value: ParameterValue<string, Record<string, unknown>>): string {
	const cn = typeof value === 'object' ? value.params.CN : undefined;
	if (typeof cn === 'string' && cn) return cn;
	const raw = typeof value === 'string' ? value : value.val;
	return raw.replace(/^mailto:/i, '').trim();
}

/** Attendee display names, or their email when no CN is given. The organiser
 * is excluded, since Google Calendar often lists them as an attendee too. */
function attendeesOf(event: VEvent): string[] {
	const organiser = emailOf(event.organizer);
	return toList(event.attendee)
		.filter((attendee) => !organiser || emailOf(attendee) !== organiser)
		.map(displayNameOf)
		.filter((name) => name !== '');
}

/** A video-call URL, matched narrowly to the providers a user is likely to
 * actually join rather than any link the event happens to mention. */
const MEETING_LINK_RE = /https?:\/\/[^\s"'<>)]*(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com)[^\s"'<>)]*/i;

function linkOf(event: VEvent): string {
	const conference = (event as Record<string, unknown>)['GOOGLE-CONFERENCE'];
	if (typeof conference === 'string' && conference.trim()) return conference.trim();

	const text = `${textValue(event.description)} ${textValue(event.location)}`;
	return MEETING_LINK_RE.exec(text)?.[0] ?? '';
}
