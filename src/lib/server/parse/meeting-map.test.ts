import { describe, expect, it } from 'vitest';
import { MEETING_MAP_HEADER, parseMeetingMap, setMapping, slugForTitle, titleKey } from './meeting-map';

const MAP = `# Meeting workspaces

Some words of my own.

- Dev Weekly Meeting → eye2gene
- Standup -> eye2gene
* 1:1 with Ana → work
- A → B title → side-projects
- not a mapping
- Dev Weekly Meeting → work
`;

describe('parseMeetingMap', () => {
	it('reads each mapping line and skips the rest', () => {
		expect(parseMeetingMap(MAP)).toEqual([
			{ title: 'Dev Weekly Meeting', slug: 'eye2gene', line: 4 },
			{ title: 'Standup', slug: 'eye2gene', line: 5 },
			{ title: '1:1 with Ana', slug: 'work', line: 6 },
			{ title: 'A → B title', slug: 'side-projects', line: 7 }
		]);
	});

	it.each([
		['- Title → slug', 'Title'],
		['  - Title  →  slug  ', 'Title'],
		['- Title → slug\r', 'Title'],
		['- Title → two words', null],
		['Title → slug', null]
	])('%j', (line, title) => {
		const [m] = parseMeetingMap(line);
		expect(m?.title ?? null).toBe(title);
	});
});

describe('slugForTitle', () => {
	it('matches regardless of case and spacing', () => {
		const map = parseMeetingMap(MAP);
		expect(slugForTitle(map, 'dev  weekly MEETING')).toBe('eye2gene');
		expect(slugForTitle(map, 'Unknown')).toBeNull();
		expect(titleKey('  A  b ')).toBe('a b');
	});
});

describe('setMapping', () => {
	it('rewrites only the slug on the existing line', () => {
		const after = setMapping(MAP, 'dev weekly meeting', 'work');
		const a = MAP.split('\n');
		const b = after.split('\n');
		expect(b).toHaveLength(a.length);
		expect(b.filter((l, i) => l !== a[i])).toEqual(['- Dev Weekly Meeting → work']);
	});

	it('keeps the arrow and spacing as written', () => {
		expect(setMapping('  - Standup  ->  old  \n', 'Standup', 'new')).toBe('  - Standup  ->  new  \n');
	});

	it('changes nothing when the slug is the same', () => {
		expect(setMapping(MAP, 'Standup', 'eye2gene')).toBe(MAP);
	});

	it.each([
		['an empty note', '', `${MEETING_MAP_HEADER}- Retro → work\n`],
		['a note ending in a newline', '# M\n', '# M\n- Retro → work\n'],
		['a note with no final newline', '# M', '# M\n- Retro → work\n']
	])('appends a new title to %s', (_name, before, after) => {
		expect(setMapping(before, ' Retro ', 'work')).toBe(after);
	});

	it('appends a line that parses back', () => {
		const after = setMapping('', 'Dev Weekly', 'eye2gene');
		expect(slugForTitle(parseMeetingMap(after), 'Dev Weekly')).toBe('eye2gene');
	});
});
