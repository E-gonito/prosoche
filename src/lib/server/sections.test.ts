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
});
