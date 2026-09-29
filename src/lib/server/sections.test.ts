import { describe, it, expect } from 'vitest';
import { appendUnderHeading } from './sections';

const TIME_LOG_HEADING = '## Time log';

const NOTE = `# [[Journal 2026]]

# Tasks
- [ ] 10:40 - 18:00 Client project \`Q1\` #ws/work
- [ ] 12:05 - 12:20 Reply to people \`Q2\`

## Time log
- 10:42 - 12:05 Client project (1h23m) \`Q1\` #ws/work
- 12:05 - 12:20 Reply to people (15m) \`Q2\` #ws/personal
just a sentence someone typed here
- 13:00 - 13:30 Something with no tags at all

## Notes
- 20:00 - 21:00 Not a time log line, this is under another heading
`;

describe('appendUnderHeading', () => {
	it('adds the line as the last of an existing section', () => {
		const result = appendUnderHeading(NOTE, TIME_LOG_HEADING, '- 14:00 - 14:30 New (30m)');
		const lines = result.content.split('\n');
		expect(lines[result.line]).toBe('- 14:00 - 14:30 New (30m)');
		// Everything above it is byte-identical, and the next heading still follows.
		expect(lines.slice(0, result.line)).toEqual(NOTE.split('\n').slice(0, result.line));
		expect(lines[result.line + 2]).toBe('## Notes');
	});

	it('creates the section at the end when the note has none', () => {
		const result = appendUnderHeading('# Tasks\n- [ ] one\n', TIME_LOG_HEADING, '- 09:00 - 09:30 Work (30m)');
		expect(result.content).toBe('# Tasks\n- [ ] one\n\n## Time log\n- 09:00 - 09:30 Work (30m)\n');
		expect(result.content.split('\n')[result.line]).toBe('- 09:00 - 09:30 Work (30m)');
	});

	it('creates the section in an empty note', () => {
		const result = appendUnderHeading('', TIME_LOG_HEADING, '- 09:00 - 09:30 Work (30m)');
		expect(result.content).toBe('## Time log\n- 09:00 - 09:30 Work (30m)\n');
		expect(result.line).toBe(1);
	});

	it('appends twice under one heading, in order', () => {
		const once = appendUnderHeading('## Log\n', '## Log', '- first');
		const twice = appendUnderHeading(once.content, '## Log', '- second');
		expect(twice.content).toBe('## Log\n- first\n- second\n');
	});

	it('changes nothing else in a note with sections after the heading', () => {
		const before = '## Time log\n- 09:00 - 09:30 One (30m)\n\n## Notes\nprose\n';
		const after = appendUnderHeading(before, TIME_LOG_HEADING, '- 10:00 - 10:30 Two (30m)');
		expect(after.content).toBe('## Time log\n- 09:00 - 09:30 One (30m)\n- 10:00 - 10:30 Two (30m)\n\n## Notes\nprose\n');
	});

	it('does not end the section at a heading-shaped line inside a code fence', () => {
		const before = '## [[Bash]]\n\nHow to comment?\n?\n```\n# like this\n```\n\n## [[Next]]\n';
		const after = appendUnderHeading(before, '## [[Bash]]', '\nQ::A');
		expect(after.content).toBe('## [[Bash]]\n\nHow to comment?\n?\n```\n# like this\n```\n\nQ::A\n\n## [[Next]]\n');
	});

	describe('filing ahead of a line the caller picks', () => {
		const newer = (day: string) => (line: string) => /^- (\d{4}-\d{2}-\d{2})/.exec(line)?.[1]! <= day;

		it.each([
			['goes on top of a newest-first list', '## History\n- 2026-09-22 First call\n', '2026-09-29', '## History\n- 2026-09-29 New\n- 2026-09-22 First call\n'],
			['files a back-dated entry in date order', '## History\n- 2026-09-29 B\n- 2026-09-01 A\n', '2026-09-10', '## History\n- 2026-09-29 B\n- 2026-09-10 New\n- 2026-09-01 A\n'],
			['goes last when nothing in the section is older', '## History\n- 2026-09-29 B\n\n## Other\n', '2026-01-01', '## History\n- 2026-09-29 B\n- 2026-01-01 New\n\n## Other\n'],
			['never looks past the section', '## History\n\n## Other\n- 2000-01-01 x\n', '2026-09-29', '## History\n- 2026-09-29 New\n\n## Other\n- 2000-01-01 x\n'],
			['keeps a blank line under the heading', '## History\n\n- 2026-09-22 First call\n', '2026-09-29', '## History\n\n- 2026-09-29 New\n- 2026-09-22 First call\n']
		])('%s', (_name, note, day, expected) => {
			expect(appendUnderHeading(note, '## History', `- ${day} New`, newer(day)).content).toBe(expected);
		});
	});
});
