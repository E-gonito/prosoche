import { describe, it, expect } from 'vitest';
import { appendUnderDay } from './capture';

describe('appendUnderDay', () => {
	it('creates the day heading on a fresh file', () => {
		expect(appendUnderDay('# Capture\n', 'call the plumber', '2026-09-21', '14:05')).toBe(
			'# Capture\n\n## 2026-09-21\n- 14:05 call the plumber\n'
		);
	});

	it('appends under an existing day', () => {
		const before = '# Capture\n\n## 2026-09-21\n- 09:00 first\n';
		expect(appendUnderDay(before, 'second', '2026-09-21', '14:05')).toBe(
			'# Capture\n\n## 2026-09-21\n- 09:00 first\n- 14:05 second\n'
		);
	});

	it('does not leak into the next day\'s section', () => {
		const before = '# Capture\n\n## 2026-09-21\n- 09:00 first\n\n## 2026-09-20\n- 10:00 older\n';
		expect(appendUnderDay(before, 'second', '2026-09-21', '14:05')).toBe(
			'# Capture\n\n## 2026-09-21\n- 09:00 first\n- 14:05 second\n\n## 2026-09-20\n- 10:00 older\n'
		);
	});

	it('keeps something already written as a task a task', () => {
		expect(appendUnderDay('# Capture\n', '- [ ] Buy milk `Q3`', '2026-09-21', '14:05')).toContain(
			'- [ ] Buy milk `Q3`'
		);
	});

	it('adds a new day above older ones without disturbing them', () => {
		const before = '# Capture\n\n## 2026-09-20\n- 10:00 older\n';
		const after = appendUnderDay(before, 'new thing', '2026-09-21', '08:00');
		expect(after).toContain('## 2026-09-20\n- 10:00 older');
		expect(after).toContain('## 2026-09-21\n- 08:00 new thing');
	});
});
