import { describe, expect, it } from 'vitest';
import {
	actionText,
	formatCaptured,
	frontmatterValue,
	meetingPath,
	newMeetingNote,
	parseCaptured,
	readMeeting,
	scanCaptured,
	scanTalkingPoints,
	setEnded,
	type CaptureInput
} from './meeting';
import { appendUnderHeading } from '../sections';

describe('parseCaptured', () => {
	it.each([
		['- term:: Cookie Cutter guess:: something for AI models', { kind: 'term', text: 'Cookie Cutter', guess: 'something for AI models', done: null }],
		['- term:: DVC', { kind: 'term', text: 'DVC', guess: null, done: null }],
		['- term:: DVC guess::', { kind: 'term', text: 'DVC', guess: null, done: null }],
		['- Term:: MLflow GUESS:: infra', { kind: 'term', text: 'MLflow', guess: 'infra', done: null }],
		['- question:: Is the ensemble versioned as one artifact?', { kind: 'question', text: 'Is the ensemble versioned as one artifact?', guess: null, done: null }],
		['- decision:: Deploy to ECS, not Beanstalk', { kind: 'decision', text: 'Deploy to ECS, not Beanstalk', guess: null, done: null }],
		['- [ ] action:: Clarify scope', { kind: 'action', text: 'Clarify scope', guess: null, done: false }],
		['- [x] action:: Clarify scope', { kind: 'action', text: 'Clarify scope', guess: null, done: true }],
		['- [ ] Book the room', { kind: 'action', text: 'Book the room', guess: null, done: false }],
		['- action:: no box', { kind: 'action', text: 'no box', guess: null, done: false }],
		['- A plain note', { kind: 'note', text: 'A plain note', guess: null, done: null }],
		['* starred note', { kind: 'note', text: 'starred note', guess: null, done: null }],
		['- note with a time:: in it', { kind: 'note', text: 'note with a time:: in it', guess: null, done: null }],
		['- A note\r', { kind: 'note', text: 'A note', guess: null, done: null }]
	])('reads %j', (raw, expected) => {
		expect(parseCaptured(raw, 4)).toEqual({ ...expected, line: 4 });
	});

	it.each([[''], ['   '], ['Prose, not a bullet'], ['## Captured'], ['\t- indented sub-bullet'], ['  - [ ] indented task'], ['- ']])(
		'ignores %j',
		(raw) => {
			expect(parseCaptured(raw)).toBeNull();
		}
	);
});

describe('formatCaptured', () => {
	it.each<[CaptureInput, string]>([
		[{ kind: 'term', text: 'Cookie Cutter', guess: 'something for AI models' }, '- term:: Cookie Cutter guess:: something for AI models'],
		[{ kind: 'term', text: 'DVC', guess: '  ' }, '- term:: DVC'],
		[{ kind: 'term', text: 'DVC' }, '- term:: DVC'],
		[{ kind: 'question', text: 'Why ECS?' }, '- question:: Why ECS?'],
		[{ kind: 'decision', text: 'Ship Friday' }, '- decision:: Ship Friday'],
		[{ kind: 'action', text: 'Email Ana' }, '- [ ] action:: Email Ana'],
		[{ kind: 'note', text: 'Room was cold' }, '- Room was cold'],
		[{ kind: 'note', text: 'two\nlines  here ' }, '- two lines here']
	])('writes %j', (input, line) => {
		expect(formatCaptured(input)).toBe(line);
	});

	it('writes lines that read back as what was captured', () => {
		for (const input of [
			{ kind: 'term', text: 'RPE', guess: 'retina layer' },
			{ kind: 'question', text: 'Is it top-5?' },
			{ kind: 'decision', text: 'Use DVC' },
			{ kind: 'action', text: 'Ask Ben' },
			{ kind: 'note', text: 'Just a note' }
		] as CaptureInput[]) {
			const item = parseCaptured(formatCaptured(input))!;
			expect(item.kind).toBe(input.kind);
			expect(item.text).toBe(input.text);
			expect(item.guess).toBe(input.guess ?? null);
		}
	});
});

const NOTE = `---
type: meeting
date: 2026-09-28
event: abc123@google.com/2026-09-28
attendees: [Ana, Ben]
---
# Dev Weekly Meeting

Some prose before.

## Captured
- term:: Cookie Cutter guess:: something for AI models
- question:: Is the ensemble versioned?
\t- a sub-point, not an item
- [ ] action:: Clarify scope
- [x] action:: Done already
- Plain note

\`\`\`
- term:: Fenced guess:: not real
\`\`\`

## Talking points
- not captured
`;

describe('scanCaptured', () => {
	it('reads only the Captured section, outside fences, with line numbers', () => {
		const items = scanCaptured(NOTE);
		expect(items.map((i) => [i.kind, i.text, i.line])).toEqual([
			['term', 'Cookie Cutter', 11],
			['question', 'Is the ensemble versioned?', 12],
			['action', 'Clarify scope', 14],
			['action', 'Done already', 15],
			['note', 'Plain note', 16]
		]);
	});

	it('finds nothing in a note without the heading', () => {
		expect(scanCaptured('# Title\n- a bullet\n')).toEqual([]);
	});
});

describe('scanTalkingPoints', () => {
	it('reads the bullets under Talking points only', () => {
		expect(scanTalkingPoints(NOTE)).toEqual(['not captured']);
		expect(scanTalkingPoints('## Talking points\n- One\n  - sub\n* Two\n\n## Captured\n- x\n')).toEqual(['One', 'Two']);
		expect(scanTalkingPoints('# none\n')).toEqual([]);
	});
});

describe('readMeeting', () => {
	it('reads the frontmatter, title and date', () => {
		const meta = readMeeting(NOTE, 'Work/Meetings/2026-09-28 Dev Weekly.md');
		expect(meta).toMatchObject({
			title: 'Dev Weekly Meeting',
			type: 'meeting',
			date: '2026-09-28',
			event: 'abc123@google.com/2026-09-28',
			attendees: ['Ana', 'Ben'],
			ended: null
		});
		expect(meta.captured).toHaveLength(5);
	});

	it('falls back to the file name and the frontmatter date', () => {
		const meta = readMeeting('---\ntype: standup\ndate: 2026-09-20\n---\nno heading\n', 'Work/Meetings/Standup.md');
		expect(meta).toMatchObject({ title: 'Standup', type: 'standup', date: '2026-09-20' });
		expect(readMeeting('', 'Work/Meetings/2026-09-21 Retro.md')).toMatchObject({ title: 'Retro', date: '2026-09-21' });
	});

	it('reads ended as written, not as a YAML number', () => {
		expect(readMeeting('---\ntype: meeting\nended: 10:45\n---\n', 'x.md').ended).toBe('10:45');
	});
});

describe('frontmatterValue', () => {
	it.each([
		['---\nended: 10:45\n---\n', '10:45'],
		['---\nended: "10:45"\n---\n', '10:45'],
		['---\nended:\n---\n', null],
		['---\nnot-ended: 1\n---\n', null],
		['ended: 10:45\n', null],
		['---\r\nended: 09:05\r\n---\r\n', '09:05']
	])('reads %j', (content, value) => {
		expect(frontmatterValue(content, 'ended')).toBe(value);
	});
});

describe('setEnded', () => {
	it.each([
		['inserts above the closing fence', '---\ntype: meeting\ndate: 2026-09-29\n---\n# T\n', '---\ntype: meeting\ndate: 2026-09-29\nended: 11:30\n---\n# T\n'],
		['rewrites an existing line', '---\ntype: meeting\nended: 10:00\ndate: x\n---\nbody\n', '---\ntype: meeting\nended: 11:30\ndate: x\n---\nbody\n'],
		['rewrites an empty value', '---\nended:\n---\n', '---\nended: 11:30\n---\n'],
		['keeps the spacing after the key', '---\nended:    10:00\n---\n', '---\nended:    11:30\n---\n'],
		['adds frontmatter to a note with none', '# T\n\n## Captured\n', '---\nended: 11:30\n---\n# T\n\n## Captured\n'],
		['keeps CRLF line endings', '---\r\ntype: meeting\r\n---\r\n# T\r\n', '---\r\ntype: meeting\r\nended: 11:30\r\n---\r\n# T\r\n'],
		['ignores an ended: in the body', '---\ntype: meeting\n---\nended: 09:00\n', '---\ntype: meeting\nended: 11:30\n---\nended: 09:00\n']
	])('%s', (_name, before, after) => {
		expect(setEnded(before, '11:30')).toBe(after);
	});

	it('changes exactly one line of a real note', () => {
		const after = setEnded(NOTE, '11:30');
		const a = NOTE.split('\n');
		const b = after.split('\n');
		expect(b).toHaveLength(a.length + 1);
		expect(b.filter((line, i) => line !== a[i < 5 ? i : i - 1])).toEqual(['ended: 11:30']);
	});
});

describe('newMeetingNote', () => {
	it('writes the template', () => {
		expect(
			newMeetingNote({ type: 'meeting', date: '2026-09-29', title: 'Dev Weekly Meeting', event: 'abc@google.com/2026-09-29', attendees: ['Ana', 'Ben'] })
		).toBe(`---
type: meeting
date: 2026-09-29
event: abc@google.com/2026-09-29
attendees: [Ana, Ben]
---
# Dev Weekly Meeting

## Captured
`);
	});

	it('leaves out an absent event and attendees', () => {
		expect(newMeetingNote({ type: 'standup', date: '2026-09-29', title: 'Standup' })).toBe(
			'---\ntype: standup\ndate: 2026-09-29\n---\n# Standup\n\n## Captured\n'
		);
	});

	it('quotes what YAML would misread', () => {
		const note = newMeetingNote({ type: 'meeting', date: '2026-09-29', title: 'T', event: 'a: b', attendees: ['Doe, Jane', 'Ann'] });
		expect(note).toContain('event: "a: b"');
		expect(note).toContain('attendees: ["Doe, Jane", Ann]');
		expect(readMeeting(note, 'x.md')).toMatchObject({ event: 'a: b', attendees: ['Doe, Jane', 'Ann'] });
	});

	it('puts drafted talking points above Captured', () => {
		const note = newMeetingNote({ type: 'meeting', date: '2026-09-29', title: 'T', talkingPoints: ['Ask about DVC', 'Follow up'] });
		expect(note).toBe('---\ntype: meeting\ndate: 2026-09-29\n---\n# T\n\n## Talking points\n- Ask about DVC\n- Follow up\n\n## Captured\n');
	});

	it('takes a capture straight under Captured', () => {
		const note = newMeetingNote({ type: 'meeting', date: '2026-09-29', title: 'T' });
		const once = appendUnderHeading(note, '## Captured', formatCaptured({ kind: 'decision', text: 'Ship it' })).content;
		const twice = appendUnderHeading(once, '## Captured', formatCaptured({ kind: 'action', text: 'Tell Ana' })).content;
		expect(twice).toBe('---\ntype: meeting\ndate: 2026-09-29\n---\n# T\n\n## Captured\n- decision:: Ship it\n- [ ] action:: Tell Ana\n');
	});
});

describe('meetingPath', () => {
	it.each([
		['Dev Weekly Meeting', [], 'Work/Meetings/2026-09-29 Dev Weekly Meeting.md'],
		['Q3: plan / review?', [], 'Work/Meetings/2026-09-29 Q3 plan review.md'],
		['  ', [], 'Work/Meetings/2026-09-29 Meeting.md'],
		['Standup', ['Work/Meetings/2026-09-29 Standup.md'], 'Work/Meetings/2026-09-29 Standup 2.md'],
		['Standup', ['Work/Meetings/2026-09-29 Standup.md', 'Work/Meetings/2026-09-29 Standup 2.md'], 'Work/Meetings/2026-09-29 Standup 3.md']
	])('%j', (title, taken, path) => {
		expect(meetingPath('Work/Meetings', '2026-09-29', title, taken)).toBe(path);
	});
});

describe('actionText', () => {
	it.each([
		['action:: Clarify scope', 'Clarify scope'],
		['Action::Clarify', 'Clarify'],
		['Book the room', 'Book the room']
	])('%j', (text, expected) => {
		expect(actionText(text)).toBe(expected);
	});
});
