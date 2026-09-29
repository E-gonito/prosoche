import { describe, it, expect, vi } from 'vitest';
import { parseIcs, type CalendarEvent } from './calendar';

/** Wraps VEVENT bodies in a minimal, otherwise valid VCALENDAR. */
function ics(...events: string[]): string {
	return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//test//EN', ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

/** One VEVENT block from its property lines. */
function vevent(lines: string[]): string {
	return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
}

/**
 * Expected day/minutes for a UTC instant, computed the same way the module
 * itself does (local `Date` getters on the UTC instant) so the assertion
 * holds regardless of the machine's own timezone.
 */
function localOf(y: number, m: number, d: number, h: number, min: number) {
	const date = new Date(Date.UTC(y, m - 1, d, h, min, 0));
	const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	return { day, minutes: date.getHours() * 60 + date.getMinutes() };
}

describe('parseIcs', () => {
	const cases: Array<{ name: string; ics: string; from: string; to: string; check: (events: CalendarEvent[]) => void }> = [
		{
			name: 'a single timed event carries a TZID converted to local day and minutes',
			ics: ics(
				vevent([
					'UID:single@test',
					'DTSTAMP:20260101T000000Z',
					'DTSTART;TZID=UTC:20260929T140000',
					'DTEND;TZID=UTC:20260929T150000',
					'SUMMARY:Standup'
				])
			),
			from: '2026-09-28',
			to: '2026-09-30',
			check(events) {
				const start = localOf(2026, 9, 29, 14, 0);
				const end = localOf(2026, 9, 29, 15, 0);
				expect(events).toHaveLength(1);
				expect(events[0]).toEqual({
					id: `single@test/${start.day}`,
					title: 'Standup',
					day: start.day,
					startMin: start.minutes,
					endMin: end.minutes,
					location: '',
					description: '',
					attendees: [],
					link: ''
				});
			}
		},
		{
			name: 'an all-day event never shifts a day and has null minutes',
			ics: ics(
				vevent([
					'UID:allday@test',
					'DTSTAMP:20260101T000000Z',
					'DTSTART;VALUE=DATE:20261005',
					'DTEND;VALUE=DATE:20261006',
					'SUMMARY:Offsite'
				])
			),
			from: '2026-10-01',
			to: '2026-10-31',
			check(events) {
				expect(events).toEqual([
					{
						id: 'allday@test/2026-10-05',
						title: 'Offsite',
						day: '2026-10-05',
						startMin: null,
						endMin: null,
						location: '',
						description: '',
						attendees: [],
						link: ''
					}
				]);
			}
		},
		{
			name: 'a bare Z (UTC) time is converted to local the same way as a TZID',
			ics: ics(
				vevent([
					'UID:utcz@test',
					'DTSTAMP:20260101T000000Z',
					'DTSTART:20260929T140000Z',
					'DTEND:20260929T150000Z',
					'SUMMARY:UTC meeting'
				])
			),
			from: '2026-09-28',
			to: '2026-09-30',
			check(events) {
				const start = localOf(2026, 9, 29, 14, 0);
				const end = localOf(2026, 9, 29, 15, 0);
				expect(events).toHaveLength(1);
				expect(events[0].day).toBe(start.day);
				expect(events[0].startMin).toBe(start.minutes);
				expect(events[0].endMin).toBe(end.minutes);
			}
		},
		{
			name: 'a multi-day timed event produces one occurrence, on its start day, clamped at midnight',
			ics: ics(
				vevent([
					'UID:multiday@test',
					'DTSTAMP:20260101T000000Z',
					'DTSTART;TZID=UTC:20260929T220000',
					'DTEND;TZID=UTC:20260930T060000',
					'SUMMARY:Overnight thing'
				])
			),
			from: '2026-09-27',
			to: '2026-10-02',
			check(events) {
				const start = localOf(2026, 9, 29, 22, 0);
				const end = localOf(2026, 9, 30, 6, 0);
				const expectedEndMin = end.day === start.day ? end.minutes : 24 * 60;
				expect(events).toHaveLength(1);
				expect(events[0].day).toBe(start.day);
				expect(events[0].startMin).toBe(start.minutes);
				expect(events[0].endMin).toBe(expectedEndMin);
			}
		},
		{
			name: 'a weekly RRULE honours an EXDATE and a RECURRENCE-ID override',
			ics: ics(
				vevent([
					'UID:weekly@test',
					'DTSTAMP:20260101T000000Z',
					'DTSTART;TZID=UTC:20260901T090000',
					'DTEND;TZID=UTC:20260901T093000',
					'RRULE:FREQ=WEEKLY;COUNT=6',
					'EXDATE;TZID=UTC:20260915T090000',
					'SUMMARY:Weekly sync'
				]),
				vevent([
					'UID:weekly@test',
					'DTSTAMP:20260101T000000Z',
					'RECURRENCE-ID;TZID=UTC:20260922T090000',
					'DTSTART;TZID=UTC:20260922T100000',
					'DTEND;TZID=UTC:20260922T103000',
					'SUMMARY:Weekly sync (moved)'
				])
			),
			from: '2026-09-01',
			to: '2026-09-30',
			check(events) {
				const days = [
					localOf(2026, 9, 1, 9, 0),
					localOf(2026, 9, 8, 9, 0),
					localOf(2026, 9, 22, 10, 0),
					localOf(2026, 9, 29, 9, 0)
				];
				expect(events.map((e) => [e.day, e.startMin, e.title])).toEqual([
					[days[0].day, days[0].minutes, 'Weekly sync'],
					[days[1].day, days[1].minutes, 'Weekly sync'],
					[days[2].day, days[2].minutes, 'Weekly sync (moved)'],
					[days[3].day, days[3].minutes, 'Weekly sync']
				]);
				// Sep 15 was excluded and Oct 6 falls outside the window.
				expect(events.some((e) => e.day.startsWith('2026-09-15'))).toBe(false);
			}
		},
		{
			name: 'a cancelled event is excluded entirely',
			ics: ics(
				vevent([
					'UID:cancelled@test',
					'DTSTAMP:20260101T000000Z',
					'DTSTART;TZID=UTC:20260910T090000',
					'DTEND;TZID=UTC:20260910T100000',
					'SUMMARY:Will not happen',
					'STATUS:CANCELLED'
				])
			),
			from: '2026-09-01',
			to: '2026-09-30',
			check(events) {
				expect(events).toEqual([]);
			}
		},
		{
			name: 'attendees carry their CN and the organiser is excluded',
			ics: ics(
				vevent([
					'UID:attendees@test',
					'DTSTAMP:20260101T000000Z',
					'DTSTART;TZID=UTC:20260910T090000',
					'DTEND;TZID=UTC:20260910T100000',
					'SUMMARY:Planning',
					'ORGANIZER;CN=Bob Boss:mailto:bob@example.com',
					'ATTENDEE;CN=Bob Boss:mailto:bob@example.com',
					'ATTENDEE;CN=Jane Doe:mailto:jane@example.com',
					'ATTENDEE:mailto:carol@example.com'
				])
			),
			from: '2026-09-01',
			to: '2026-09-30',
			check(events) {
				expect(events).toHaveLength(1);
				expect(events[0].attendees).toEqual(['Jane Doe', 'carol@example.com']);
			}
		},
		{
			name: 'a Meet link in X-GOOGLE-CONFERENCE is preferred over one in the description',
			ics: ics(
				vevent([
					'UID:linkconf@test',
					'DTSTAMP:20260101T000000Z',
					'DTSTART;TZID=UTC:20260910T090000',
					'DTEND;TZID=UTC:20260910T100000',
					'SUMMARY:Sync',
					'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij',
					'DESCRIPTION:No link here'
				])
			),
			from: '2026-09-01',
			to: '2026-09-30',
			check(events) {
				expect(events[0].link).toBe('https://meet.google.com/abc-defg-hij');
			}
		},
		{
			name: 'a Meet link is found inside the description when there is no X-GOOGLE-CONFERENCE',
			ics: ics(
				vevent([
					'UID:linkdesc@test',
					'DTSTAMP:20260101T000000Z',
					'DTSTART;TZID=UTC:20260910T090000',
					'DTEND;TZID=UTC:20260910T100000',
					'SUMMARY:Sync',
					'DESCRIPTION:Join here: https://meet.google.com/xyz-uvwx-rst for the call'
				])
			),
			from: '2026-09-01',
			to: '2026-09-30',
			check(events) {
				expect(events[0].link).toBe('https://meet.google.com/xyz-uvwx-rst');
			}
		}
	];

	for (const c of cases) {
		it(c.name, () => c.check(parseIcs(c.ics, c.from, c.to)));
	}
});

describe('eventsBetween', () => {
	it('reports not-configured and never fetches when no URL is set', async () => {
		vi.resetModules();
		delete process.env.HUB_GCAL_ICS;
		const { eventsBetween } = await import('./calendar');
		const fetchImpl = (() => {
			throw new Error('must not be called without a configured URL');
		}) as unknown as typeof fetch;

		const result = await eventsBetween('2026-09-29', '2026-09-29', { fetchImpl });

		expect(result).toEqual({
			ok: false,
			reason: 'not-configured',
			message: 'No Google Calendar address is set (HUB_GCAL_ICS).'
		});
	});

	it('serves a fetched feed from the cache without fetching again inside the TTL', async () => {
		vi.resetModules();
		process.env.HUB_GCAL_ICS = 'https://stub.example/secret.ics';
		const { eventsBetween } = await import('./calendar');
		const feed = ics(
			vevent([
				'UID:cached@test',
				'DTSTAMP:20260101T000000Z',
				'DTSTART;TZID=UTC:20260910T090000',
				'DTEND;TZID=UTC:20260910T100000',
				'SUMMARY:Cached meeting'
			])
		);
		let calls = 0;
		const fetchImpl = (async () => {
			calls++;
			return new Response(feed, { status: 200 });
		}) as unknown as typeof fetch;

		const first = await eventsBetween('2026-09-01', '2026-09-30', { fetchImpl, now: new Date('2026-09-10T00:00:00Z') });
		const second = await eventsBetween('2026-09-01', '2026-09-30', { fetchImpl, now: new Date('2026-09-10T00:01:00Z') });

		expect(calls).toBe(1);
		expect(first.ok).toBe(true);
		expect(second).toEqual(first);
	});

	it('falls back to the stale cached feed when a later fetch fails', async () => {
		vi.resetModules();
		process.env.HUB_GCAL_ICS = 'https://stub.example/secret.ics';
		const { eventsBetween } = await import('./calendar');
		const feed = ics(
			vevent([
				'UID:stale@test',
				'DTSTAMP:20260101T000000Z',
				'DTSTART;TZID=UTC:20260910T090000',
				'DTEND;TZID=UTC:20260910T100000',
				'SUMMARY:Still here'
			])
		);
		let calls = 0;
		const fetchImpl = (async () => {
			calls++;
			if (calls === 1) return new Response(feed, { status: 200 });
			throw new Error('network down');
		}) as unknown as typeof fetch;

		const first = await eventsBetween('2026-09-01', '2026-09-30', { fetchImpl, now: new Date('2026-09-10T00:00:00Z') });
		// Well past the cache TTL, so this call must attempt a refetch, which fails.
		const second = await eventsBetween('2026-09-01', '2026-09-30', { fetchImpl, now: new Date('2026-09-10T02:00:00Z') });

		expect(calls).toBe(2);
		expect(second.ok).toBe(true);
		expect(second).toEqual(first);
	});

	it('reports unreachable when the first fetch fails and there is nothing cached', async () => {
		vi.resetModules();
		process.env.HUB_GCAL_ICS = 'https://stub.example/secret.ics';
		const { eventsBetween } = await import('./calendar');
		const fetchImpl = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;

		const result = await eventsBetween('2026-09-01', '2026-09-30', { fetchImpl });

		expect(result.ok).toBe(false);
		expect(result).toMatchObject({ ok: false, reason: 'unreachable' });
	});
});
