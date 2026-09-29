import { describe, it, expect } from 'vitest';
import { newDateLine, parseDateLine, rewriteStageLine, scanDates } from './dating-person';

describe('parseDateLine', () => {
	it('reads the artifact shape', () => {
		const line = parseDateLine('- 2026-09-20 Coffee at Monmouth rating:: 4 cost:: 9 notes:: easy conversation');
		expect(line).toMatchObject({
			day: '2026-09-20',
			text: 'Coffee at Monmouth',
			rating: 4,
			cost: 9,
			notes: 'easy conversation'
		});
	});

	it('defaults absent fields to null rather than zero', () => {
		const line = parseDateLine('- 2026-09-20 Coffee at Monmouth')!;
		expect(line.rating).toBeNull();
		expect(line.cost).toBeNull();
		expect(line.notes).toBe('');
	});

	it('keeps "::" inside notes as text', () => {
		const line = parseDateLine('- 2026-09-20 Drinks notes:: talked about work::life balance')!;
		expect(line.notes).toBe('talked about work::life balance');
	});

	it('is not fooled by a heading or plain prose', () => {
		expect(parseDateLine('## Dates')).toBeNull();
		expect(parseDateLine('Some prose about a date, not a log line.')).toBeNull();
	});
});

describe('scanDates', () => {
	it('reads every dates line under any heading, in file order', () => {
		const content = [
			'---',
			'type: person',
			'stage: dating',
			'---',
			'',
			'## Dates',
			'- 2026-09-10 First coffee rating:: 3',
			'- 2026-09-20 Coffee at Monmouth rating:: 4 cost:: 9 notes:: easy conversation'
		].join('\n');
		const dates = scanDates(content);
		expect(dates.map((d) => d.day)).toEqual(['2026-09-10', '2026-09-20']);
	});
});

describe('newDateLine', () => {
	it('matches the artifact shape', () => {
		expect(newDateLine('2026-09-20', 'Coffee at Monmouth', { rating: 4, cost: 9, notes: 'easy conversation' })).toBe(
			'- 2026-09-20 Coffee at Monmouth rating:: 4 cost:: 9 notes:: easy conversation'
		);
	});

	it('omits absent fields entirely', () => {
		expect(newDateLine('2026-09-20', 'Coffee at Monmouth', {})).toBe('- 2026-09-20 Coffee at Monmouth');
	});
});

describe('rewriteStageLine', () => {
	const withStage = ['---', 'type: person', 'app: Hinge', 'stage: talking', '---', '', '# Ada'].join('\n');

	it('replaces only the stage value', () => {
		const out = rewriteStageLine(withStage, 'dating');
		expect(out).toBe(['---', 'type: person', 'app: Hinge', 'stage: dating', '---', '', '# Ada'].join('\n'));
	});

	it('tolerates odd spacing after the colon', () => {
		const odd = ['---', 'stage:    talking', '---', ''].join('\n');
		expect(rewriteStageLine(odd, 'ended')).toBe(['---', 'stage:    ended', '---', ''].join('\n'));
	});

	it('inserts a stage line when frontmatter exists but has none', () => {
		const noStage = ['---', 'type: person', 'app: Hinge', '---', '', '# Ada'].join('\n');
		const out = rewriteStageLine(noStage, 'matched');
		expect(out).toBe(['---', 'type: person', 'app: Hinge', 'stage: matched', '---', '', '# Ada'].join('\n'));
	});

	it('adds a minimal frontmatter block when there is none at all', () => {
		expect(rewriteStageLine('# Ada\n', 'matched')).toBe('---\nstage: matched\n---\n\n# Ada\n');
	});

	it('touches nothing else in the file', () => {
		const out = rewriteStageLine(withStage, 'ended');
		expect(out.split('\n').filter((_, i) => i !== 3)).toEqual(withStage.split('\n').filter((_, i) => i !== 3));
	});
});
