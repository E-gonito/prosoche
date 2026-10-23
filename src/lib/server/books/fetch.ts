/**
 * Fetching a page for a book on someone's say-so, without becoming a way to
 * reach the server's own network.
 *
 * A pasted URL is the one place prosoche fetches something a user named, so
 * this module is the only door: http(s) only, the host resolved first and
 * refused when any address it has is private, loopback, link-local, tailnet
 * or otherwise not the public internet, redirects followed by hand with each
 * hop checked again, a time limit, a size limit enforced while the bytes
 * arrive, and a `User-Agent` that says what is asking.
 *
 * Residual risk, stated plainly: the address is checked, then the platform's
 * `fetch` resolves the name again to connect. A hostile DNS server that
 * answers a public address to the first lookup and a private one to the
 * second could slip through. Closing that needs the connection itself pinned
 * to the checked address, which the injectable `fetch` does not allow. This
 * is a one-person reader behind a tailnet, so the window is accepted.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from '../config';

export const USER_AGENT = 'prosoche (personal reader)';
export const MAX_REDIRECTS = 5;
export const TIMEOUT_MS = 20_000;
export const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

/** Resolve a host to every address it has; `dns.lookup(host, { all: true })` has this shape. */
export type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;

export interface SafeFetchOptions {
	/** Replaces the platform's `fetch`, for tests. */
	fetch?: typeof fetch;
	/** Replaces the DNS lookup, for tests. */
	lookup?: Lookup;
	/** Milliseconds allowed for each request, headers and body together. Default 20 s. */
	timeoutMs?: number;
	/** The most bytes one response may have. Default 50 MB. */
	maxBytes?: number;
	/** Extra request headers, such as `Accept`. */
	headers?: Record<string, string>;
}

export type SafeFetchFailure = {
	ok: false;
	/**
	 * `bad-url`: not http(s), or has a login in it. `blocked`: the host is, or
	 * resolves to, an address that is not the public internet. `network`: no
	 * answer, a reset, a name that does not resolve. `timeout`. `too-large`.
	 * `redirects`: too many hops, or a redirect with nowhere to go.
	 * `status`: the server answered, but not 2xx; `status` says which.
	 */
	reason: 'bad-url' | 'blocked' | 'network' | 'timeout' | 'too-large' | 'redirects' | 'status';
	message: string;
	status?: number;
};

export type SafeFetchResult =
	| { ok: true; status: number; /** The address after redirects. */ url: string; contentType: string; bytes: Uint8Array }
	| SafeFetchFailure;

/**
 * GET `url` and answer its whole body, or why it could not. Side effects: DNS
 * lookups and network requests only. Never throws, never follows a redirect
 * without checking where it goes, never reads past `maxBytes`, and never
 * touches a private address unless `config.books.allowLocalFetch` is set
 * (which only the e2e suite does).
 */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
	const doFetch = opts.fetch ?? fetch;
	const lookup: Lookup = opts.lookup ?? ((host) => dnsLookup(host, { all: true }));
	const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
	const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES;

	let current = url;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const refusal = await checkUrl(current, lookup);
		if (refusal) return refusal;

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await doFetch(current, {
				redirect: 'manual',
				signal: controller.signal,
				headers: { 'user-agent': USER_AGENT, ...opts.headers }
			});

			if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
				drop(res);
				try {
					current = new URL(res.headers.get('location')!, current).href;
				} catch {
					return { ok: false, reason: 'redirects', message: `${current} redirected to an address that is not a URL.` };
				}
				continue;
			}
			if (res.status < 200 || res.status >= 300) {
				drop(res);
				return { ok: false, reason: 'status', status: res.status, message: `${current} answered ${res.status}.` };
			}

			const declared = Number(res.headers.get('content-length'));
			if (Number.isFinite(declared) && declared > maxBytes) {
				drop(res);
				return tooLarge(current, maxBytes);
			}
			const bytes = await readCapped(res, maxBytes);
			if (!bytes) return tooLarge(current, maxBytes);
			return { ok: true, status: res.status, url: current, contentType: res.headers.get('content-type') ?? '', bytes };
		} catch (e) {
			if (controller.signal.aborted) return { ok: false, reason: 'timeout', message: `${current} did not answer within ${Math.round(timeoutMs / 1000)} seconds.` };
			return { ok: false, reason: 'network', message: `${current} could not be reached: ${describe(e)}` };
		} finally {
			clearTimeout(timer);
		}
	}
	return { ok: false, reason: 'redirects', message: `${url} redirected more than ${MAX_REDIRECTS} times.` };
}

/**
 * Whether a connection to this IP address (v4 or v6, as text) stays out of
 * what a user's say-so must not reach. True when the address is public.
 *
 * Refused: loopback; private (10/8, 172.16/12, 192.168/16); link-local
 * (169.254/16, fe80::/10); tailnet and carrier-grade NAT (100.64/10);
 * unique-local (fc00::/7); unspecified (0.0.0.0/8, ::); multicast; and the
 * reserved, benchmarking and documentation blocks nothing legitimate lives
 * in. An IPv6 address that carries an IPv4 one (IPv4-mapped `::ffff:a.b.c.d`,
 * IPv4-compatible `::a.b.c.d`, NAT64 `64:ff9b::/96`, 6to4 `2002::/16`) is
 * judged by the IPv4 address inside. Text that is not an IP address is
 * refused. Pure.
 */
export function isPublicAddress(address: string): boolean {
	const text = address.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
	const family = isIP(text);
	if (family === 4) return isPublicV4(parseV4(text)!);
	if (family === 6) return isPublicV6(parseV6(text)!);
	return false;
}

// ---------------------------------------------------------------------------

async function checkUrl(raw: string, lookup: Lookup): Promise<SafeFetchFailure | null> {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return { ok: false, reason: 'bad-url', message: `"${raw}" is not a web address.` };
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'bad-url', message: `Only http and https addresses can be saved, not ${u.protocol}` };
	if (u.username || u.password) return { ok: false, reason: 'bad-url', message: 'An address with a login in it cannot be saved.' };
	if (config.books.allowLocalFetch) return null;

	// `URL` has already turned 0x7f.1 and 2130706433 into 127.0.0.1.
	const host = u.hostname.replace(/^\[|\]$/g, '');
	if (isIP(host)) return isPublicAddress(host) ? null : blocked(host, host);

	let addresses: { address: string }[];
	try {
		addresses = await lookup(host);
	} catch (e) {
		return { ok: false, reason: 'network', message: `${host} could not be found: ${describe(e)}` };
	}
	if (addresses.length === 0) return { ok: false, reason: 'network', message: `${host} has no address.` };
	const bad = addresses.find((a) => !isPublicAddress(a.address));
	return bad ? blocked(host, bad.address) : null;
}

function blocked(host: string, address: string): SafeFetchFailure {
	return { ok: false, reason: 'blocked', message: `${host} is ${host === address ? 'an address' : `at ${address}, an address`} on a private or local network, which prosoche does not fetch from.` };
}

function tooLarge(url: string, maxBytes: number): SafeFetchFailure {
	return { ok: false, reason: 'too-large', message: `${url} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.` };
}

/** The body, or null once more than `maxBytes` have arrived (the rest is dropped unread). */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
	if (!res.body) return new Uint8Array(0);
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			void reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.byteLength;
	}
	return out;
}

/** Give up on a response's body without waiting for the server to notice. */
function drop(res: Response): void {
	void res.body?.cancel().catch(() => {});
}

function describe(e: unknown): string {
	const err = e as { message?: string; cause?: { message?: string; code?: string } };
	return err.cause?.code ?? err.cause?.message ?? err.message ?? String(e);
}

function parseV4(text: string): number[] | null {
	const parts = text.split('.');
	if (parts.length !== 4) return null;
	const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
	return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

function isPublicV4([a, b, c]: number[]): boolean {
	if (a === 0) return false; // 0.0.0.0/8, "this network"
	if (a === 10) return false;
	if (a === 100 && b >= 64 && b <= 127) return false; // 100.64/10: CGNAT, and Tailscale
	if (a === 127) return false;
	if (a === 169 && b === 254) return false;
	if (a === 172 && b >= 16 && b <= 31) return false;
	if (a === 192 && b === 0 && c === 0) return false; // 192.0.0.0/24, IETF protocol assignments
	if (a === 192 && b === 168) return false;
	if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
	if (a >= 224) return false; // multicast 224/4, reserved 240/4, broadcast
	return true;
}

/** Eight 16-bit groups, or null when the text is not an IPv6 address. */
function parseV6(text: string): number[] | null {
	let head = text;
	let tail: number[] = [];
	// A dotted IPv4 tail takes the place of the last two groups.
	const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(head);
	if (dotted) {
		const v4 = parseV4(dotted[1]);
		if (!v4) return null;
		tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
		head = head.slice(0, -dotted[1].length) + '0:0';
	}
	const halves = head.split('::');
	if (halves.length > 2) return null;
	const groups = (s: string) => (s === '' ? [] : s.split(':'));
	const left = groups(halves[0]);
	const right = halves.length === 2 ? groups(halves[1]) : [];
	const all = (list: string[]) => list.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
	let result: number[];
	if (halves.length === 2) {
		const fill = 8 - left.length - right.length;
		if (fill < 1) return null;
		result = [...all(left), ...new Array<number>(fill).fill(0), ...all(right)];
	} else {
		result = all(left);
	}
	if (result.length !== 8 || result.some(Number.isNaN)) return null;
	if (dotted) {
		result[6] = tail[0];
		result[7] = tail[1];
	}
	return result;
}

function isPublicV6(g: number[]): boolean {
	const v4 = (hi: number, lo: number) => [hi >> 8, hi & 255, lo >> 8, lo & 255];
	const first6Zero = g.slice(0, 6).every((x) => x === 0);
	if (g.every((x) => x === 0)) return false; // ::
	if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
	if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPublicV4(v4(g[6], g[7])); // ::ffff:a.b.c.d, IPv4-mapped
	if (first6Zero) return isPublicV4(v4(g[6], g[7])); // ::a.b.c.d, IPv4-compatible
	if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicV4(v4(g[6], g[7])); // 64:ff9b::/96, NAT64
	if (g[0] === 0x2002) return isPublicV4(v4(g[1], g[2])); // 2002::/16, 6to4
	if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
	if ((g[0] & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local, deprecated
	if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique-local
	if ((g[0] & 0xff00) === 0xff00) return false; // ff00::/8 multicast
	if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
	return true;
}
