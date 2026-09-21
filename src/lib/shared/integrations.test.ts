import { describe, it, expect } from 'vitest';
import { issueCardLine } from './integrations';

const issue = { ref: '#2097', title: 'PDF export drops the last page', url: 'https://github.com/atlas/data-portal/issues/2097' };

describe('issueCardLine', () => {
	it('writes the vault’s own task grammar, with the issue link in the text', () => {
		expect(issueCardLine(issue, 'atlas')).toBe(
			'- [ ] PDF export drops the last page [#2097](https://github.com/atlas/data-portal/issues/2097) `Q2` #ws/atlas'
		);
	});

	it('works the same for a Linear identifier', () => {
		const line = issueCardLine({ ref: 'ENG-42', title: 'Tidy the import path', url: 'https://linear.app/atlas/issue/ENG-42' }, 'atlas');
		expect(line).toContain('[ENG-42](https://linear.app/atlas/issue/ENG-42)');
	});

	it('takes the quadrant, since not every issue is a Q2', () => {
		expect(issueCardLine(issue, 'atlas', 1)).toContain('`Q1`');
	});

	it('leaves the tag off rather than writing an empty one', () => {
		expect(issueCardLine(issue, '   ')).not.toContain('#ws/');
	});

	it('flattens a title onto one line, because a task is a line', () => {
		const line = issueCardLine({ ...issue, title: 'Fix the\n  export\tpath' }, 'w');
		expect(line).toBe('- [ ] Fix the export path [#2097](https://github.com/atlas/data-portal/issues/2097) `Q2` #ws/w');
	});

	it('falls back to the reference when an issue has no title at all', () => {
		expect(issueCardLine({ ...issue, title: '   ' }, 'w')).toContain('- [ ] #2097 [#2097]');
	});
});
