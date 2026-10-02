import { describe, it, expect } from 'vitest';
import { editLike, isLike, readLike, settleLike } from './like';

const NOTE = '---\ntype: person\nage: \nstage: liked\nliked: 2026-10-01\nchance: 10\n---\n\n# Ada\n\nMet on Hinge.\n\n## Dates\n- 2026-10-05 Coffee\n';
const opts = { today: '2026-10-02', fallbackDay: '2026-09-01', days: 7 };

describe('readLike', () => {
	it('reads the record, unknown tags as null, and the note without its title or dates', () => {
		expect(readLike('Private/Dating/People/Ada.md', NOTE, 'h', '2026-09-01')).toEqual({
			id: 'Ada', label: 'Ada', sentDate: '2026-10-01', forecast: 10, outOfLeague: null, fitsType: null, age: null,
			likedOn: null, commented: null, status: 'pending', resolvedDate: null, resolvedBy: null, notes: 'Met on Hinge.',
			sentDateMigrated: false, hash: 'h'
		});
	});

	it('is not a like without a forecast', () => {
		expect(isLike('---\nstage: matched\n---\n')).toBe(false);
		expect(readLike('P/Bo.md', '---\nstage: matched\n---\n', 'h', '2026-09-01')).toBeNull();
	});

	it('reads false as false, and anything unreadable as unknown', () => {
		const like = readLike('P/Cy.md', '---\nchance: 0\nfits_type: false\nout_of_league: maybe\nage: twenty\nliked_on: video\n---\n', 'h', '2026-09-01')!;
		expect(like).toMatchObject({ forecast: 2, fitsType: false, outOfLeague: null, age: null, likedOn: null, sentDate: '2026-09-01', sentDateMigrated: true });
	});
});

describe('editLike', () => {
	it('changes only the lines it sets, and clears to unknown with null', () => {
		const out = editLike(NOTE, { fitsType: true, age: 27, forecast: 100 });
		expect(out).toBe(NOTE.replace('age: \n', 'age: 27\n').replace('chance: 10\n', 'chance: 98\nfits_type: true\n'));
		expect(editLike(out, { fitsType: null })).toBe(out.replace('fits_type: true', 'fits_type:'));
		expect(editLike(NOTE, {})).toBe(NOTE);
	});
});

describe('settleLike', () => {
	it.each<[string, string, object]>([
		['adds pending to a like that has no status', NOTE, { status: 'pending' }],
		['clamps a 0', NOTE.replace('chance: 10', 'chance: 0'), { forecast: 2, status: 'pending' }],
		['clamps a 100', NOTE.replace('chance: 10', 'chance: 100'), { forecast: 98, status: 'pending' }],
		['marks yes when her stage already says she replied', NOTE.replace('stage: liked', 'stage: dating'), { status: 'yes', resolvedDate: '2026-10-02', resolvedBy: 'manual' }],
		['keeps a like pending on its seventh day', NOTE.replace('liked: 2026-10-01', 'liked: 2026-09-25').replace('chance: 10', 'chance: 10\nstatus: pending'), {}],
		['resolves it to no by auto on its eighth', NOTE.replace('liked: 2026-10-01', 'liked: 2026-09-24').replace('chance: 10', 'chance: 10\nstatus: pending'), { status: 'no', resolvedDate: '2026-10-02', resolvedBy: 'auto' }],
		['dates an auto no from the day the rule applied, not from today', NOTE.replace('liked: 2026-10-01', 'liked: 2026-09-01').replace('chance: 10', 'chance: 10\nstatus: pending'), { status: 'no', resolvedDate: '2026-09-09', resolvedBy: 'auto' }],
		['never touches a like already resolved', NOTE.replace('liked: 2026-10-01', 'liked: 2026-01-01').replace('chance: 10', 'chance: 10\nstatus: yes'), {}],
		['supplies a missing day and marks it', NOTE.replace('liked: 2026-10-01\n', '').replace('chance: 10', 'chance: 10\nstatus: pending'), { sentDate: '2026-09-01', sentDateMigrated: true, status: 'no', resolvedDate: '2026-09-09', resolvedBy: 'auto' }],
		['leaves a person with no forecast alone', '---\nstage: liked\n---\n', {}]
	])('%s', (_name, content, change) => {
		expect(settleLike(content, opts)).toEqual(change);
	});
});
