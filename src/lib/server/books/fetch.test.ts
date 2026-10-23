import { describe, expect, it } from 'vitest';
import { isPublicAddress, safeFetch, MAX_REDIRECTS, USER_AGENT, type Lookup } from './fetch';

describe('isPublicAddress', () => {
	const refused = [
		'127.0.0.1', '127.8.8.8', '0.0.0.0', '0.1.2.3',
		'10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1',
		'169.254.169.254', '100.64.0.1', '100.100.100.100', '100.127.255.255',
		'224.0.0.1', '239.255.255.250', '255.255.255.255', '240.0.0.1', '198.18.0.1', '192.0.0.8',
		'::', '::1', '0:0:0:0:0:0:0:1', 'fe80::1', 'febf::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', 'fec0::1', '2001:db8::1',
		'::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.1.2.3', '::ffff:192.168.0.1', '::ffff:a9fe:a9fe', '::ffff:100.64.0.1',
		'::127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1', '[::1]', 'fe80::1%eth0',
		'not an address', '', '1.2.3', '256.1.1.1', '1.2.3.4.5'
	];
	const allowed = [
		'1.1.1.1', '8.8.8.8', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1',
		'192.167.1.1', '169.253.1.1', '223.255.255.255', '198.17.0.1', '198.20.0.1',
		'2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1'
	];
	it.each(refused)('refuses %s', (a) => expect(isPublicAddress(a)).toBe(false));
	it.each(allowed)('allows %s', (a) => expect(isPublicAddress(a)).toBe(true));
});

const PUBLIC: Lookup = async () => [{ address: '93.184.216.34', family: 4 }];

function reply(body: string | Uint8Array, init: ResponseInit = {}): Response {
	return new Response(body as BodyInit, init);
}

describe('safeFetch', () => {
	it('fetches a page with the prosoche user agent', async () => {
		let seen: Headers | undefined;
		const f = (async (_u: string, init: RequestInit) => {
			seen = new Headers(init.headers);
			return reply('hello', { headers: { 'content-type': 'text/plain' } });
		}) as unknown as typeof fetch;
		const r = await safeFetch('https://books.test/a', { fetch: f, lookup: PUBLIC });
		expect(r.ok && new TextDecoder().decode(r.bytes)).toBe('hello');
		expect(r.ok && r.contentType).toBe('text/plain');
		expect(seen?.get('user-agent')).toBe(USER_AGENT);
	});

	it.each(['ftp://books.test/a', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', 'https://user:pw@books.test/'])('refuses the address %s', async (u) => {
		const f = (async () => { throw new Error('should not fetch'); }) as unknown as typeof fetch;
		const r = await safeFetch(u, { fetch: f, lookup: PUBLIC });
		expect(r).toMatchObject({ ok: false, reason: 'bad-url' });
	});

	it('refuses a host that resolves to a private address, and one with any private address', async () => {
		const f = (async () => reply('x')) as unknown as typeof fetch;
		const lan: Lookup = async () => [{ address: '192.168.1.5', family: 4 }];
		const mixed: Lookup = async () => [{ address: '93.184.216.34', family: 4 }, { address: 'fd00::1', family: 6 }];
		expect(await safeFetch('https://nas.test/', { fetch: f, lookup: lan })).toMatchObject({ ok: false, reason: 'blocked' });
		expect(await safeFetch('https://nas.test/', { fetch: f, lookup: mixed })).toMatchObject({ ok: false, reason: 'blocked' });
	});

	it('refuses IP literals without looking them up, including odd spellings', async () => {
		const f = (async () => reply('x')) as unknown as typeof fetch;
		const lookup: Lookup = async () => { throw new Error('no lookup for a literal'); };
		for (const u of ['http://127.0.0.1/', 'http://[::1]/', 'http://2130706433/', 'http://0x7f.1/', 'http://100.101.102.103:3100/', 'http://[::ffff:10.0.0.1]/', 'http://169.254.169.254/latest']) {
			expect(await safeFetch(u, { fetch: f, lookup })).toMatchObject({ ok: false, reason: 'blocked' });
		}
	});

	it('checks every redirect hop, not only the first', async () => {
		const seen: string[] = [];
		const f = (async (u: string) => {
			seen.push(u);
			return reply('', { status: 302, headers: { location: 'http://internal.test/admin' } });
		}) as unknown as typeof fetch;
		const lookup: Lookup = async (h) => [{ address: h === 'internal.test' ? '10.0.0.7' : '93.184.216.34', family: 4 }];
		const r = await safeFetch('https://books.test/start', { fetch: f, lookup });
		expect(r).toMatchObject({ ok: false, reason: 'blocked' });
		expect(seen).toEqual(['https://books.test/start']);
	});

	it('follows relative redirects and answers the final address', async () => {
		const f = (async (u: string) =>
			u.endsWith('/old') ? reply('', { status: 301, headers: { location: '/new/' } }) : reply('done')) as unknown as typeof fetch;
		const r = await safeFetch('https://books.test/old', { fetch: f, lookup: PUBLIC });
		expect(r).toMatchObject({ ok: true, url: 'https://books.test/new/' });
	});

	it(`stops after ${MAX_REDIRECTS} redirects`, async () => {
		let n = 0;
		const f = (async () => reply('', { status: 302, headers: { location: `/${++n}` } })) as unknown as typeof fetch;
		expect(await safeFetch('https://books.test/', { fetch: f, lookup: PUBLIC })).toMatchObject({ ok: false, reason: 'redirects' });
		expect(n).toBe(MAX_REDIRECTS + 1);
	});

	it('reports a status that is not 2xx', async () => {
		const f = (async () => reply('nope', { status: 404 })) as unknown as typeof fetch;
		expect(await safeFetch('https://books.test/x', { fetch: f, lookup: PUBLIC })).toMatchObject({ ok: false, reason: 'status', status: 404 });
	});

	it('stops reading at the size cap, with or without a Content-Length', async () => {
		const big = new Uint8Array(2000);
		const noLength = (async () => reply(big)) as unknown as typeof fetch;
		const declared = (async () => reply(big, { headers: { 'content-length': '2000' } })) as unknown as typeof fetch;
		expect(await safeFetch('https://books.test/x', { fetch: noLength, lookup: PUBLIC, maxBytes: 1000 })).toMatchObject({ ok: false, reason: 'too-large' });
		expect(await safeFetch('https://books.test/x', { fetch: declared, lookup: PUBLIC, maxBytes: 1000 })).toMatchObject({ ok: false, reason: 'too-large' });
		expect(await safeFetch('https://books.test/x', { fetch: noLength, lookup: PUBLIC, maxBytes: 2000 })).toMatchObject({ ok: true });
	});

	it('times out a request that never answers', async () => {
		const f = ((_u: string, init: RequestInit) =>
			new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
		expect(await safeFetch('https://books.test/x', { fetch: f, lookup: PUBLIC, timeoutMs: 30 })).toMatchObject({ ok: false, reason: 'timeout' });
	});

	it('answers a network error instead of throwing', async () => {
		const f = (async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); }) as unknown as typeof fetch;
		const r = await safeFetch('https://books.test/x', { fetch: f, lookup: PUBLIC });
		expect(r).toMatchObject({ ok: false, reason: 'network' });
		expect(!r.ok && r.message).toContain('ECONNREFUSED');
		const gone: Lookup = async () => { throw new Error('ENOTFOUND'); };
		expect(await safeFetch('https://nope.test/', { fetch: f, lookup: gone })).toMatchObject({ ok: false, reason: 'network' });
	});
});
