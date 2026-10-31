import { describe, it, expect } from 'vitest';
import { parseLinks } from './links';

describe('parseLinks', () => {
	it('reads each list item that is a link, in file order', () => {
		const { links, problems } = parseLinks('# Links\n\n- [Proxmox](https://100.65.91.62:8006)\n* [Router](http://10.0.0.1)\n');
		expect(links).toEqual([
			{ title: 'Proxmox', href: 'https://100.65.91.62:8006' },
			{ title: 'Router', href: 'http://10.0.0.1' }
		]);
		expect(problems).toEqual([]);
	});

	it('leaves headings, prose and other list items alone', () => {
		expect(parseLinks('Some notes\n- a plain item\n- [ ] a task\n\n').links).toEqual([]);
		expect(parseLinks('Some notes\n- a plain item\n- [ ] a task\n\n').problems).toEqual([]);
	});

	it('reports a link item it cannot use, with its line', () => {
		const { links, problems } = parseLinks('- [Proxmox](100.65.91.62:8006)\n- [Shell](javascript:alert(1))\n- [Half](https://x');
		expect(links).toEqual([]);
		expect(problems).toHaveLength(3);
		expect(problems[0]).toContain('line 1');
		expect(problems[2]).toContain('line 3');
	});

	it('reads an empty or missing file as no links', () => {
		expect(parseLinks('')).toEqual({ links: [], problems: [] });
	});
});
