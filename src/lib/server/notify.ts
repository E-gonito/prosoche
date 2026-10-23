/**
 * Web Push: the only place that knows how a notification reaches a device.
 *
 * Nothing else imports `web-push`, builds a VAPID header or knows the shape of
 * a browser's push subscription. Callers (the nudge loop, the Settings route)
 * say who to tell and what; this file does the rest, so swapping Web Push for
 * another channel (see `docs/plan-start.md`, "If Web Push turns out
 * unreliable") changes this file and no other.
 *
 * Subscriptions live in `_hub/.state/push.json`, which git sync never offers
 * for commit: a device is subscribed on the server it subscribed to, and
 * never travels with the vault. A push carries `{ title, body, url, tag }`,
 * encrypted from here to the device, so the push service relays words it
 * cannot read. A push is sent once with a ten-minute life and is never
 * retried: a late nudge is worse than a missing one.
 */

import { config, type PushConfig } from './config';
import type { Vault } from './vault/index';

const STATE = `${config.hubFolder}/.state/push.json`;

/** How long a push service keeps a message for a device that is offline. Past this a nudge is stale. */
const TTL_SECONDS = 10 * 60;

/** Longest label kept; a label is only there to tell devices apart in a list. */
const LABEL_MAX = 60;

/** A browser's `PushSubscription.toJSON()`, trimmed to what sending needs. */
export interface PushSubscriptionJson {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}

/** A stored device: where to send, and a name a person can recognise. */
export interface Device extends PushSubscriptionJson {
	label: string;
	/** ISO-8601 instant the device subscribed. */
	addedAt: string;
}

/** What a person may see of a device. Never the keys. */
export interface DeviceInfo {
	endpoint: string;
	label: string;
	addedAt: string;
}

/** The words of one push. `url` is a path on this app, e.g. `/focus/start?day=2026-10-23&line=12`. */
export interface Notification {
	title: string;
	body: string;
	url: string;
	/** A push with the same tag replaces the one already showing instead of stacking. */
	tag: string;
}

/** What `send` did, counted per device. */
export interface SendResult {
	sent: number;
	/** Not delivered and kept: logged, not retried. */
	failed: number;
	/** Answered 404 or 410: the device unsubscribed, so it was dropped from the list. */
	removed: number;
}

/** Sends one encrypted payload to one subscription; rejects with an object carrying `statusCode` when the push service refuses. */
export type Sender = (
	subscription: PushSubscriptionJson,
	payload: string,
	options: { TTL: number; urgency: 'high' }
) => Promise<unknown>;

/** Refusal in the shape `api/route.ts` turns into a status and a sentence. */
type Refused = { ok: false; reason: string; message: string };

/**
 * Whether pushes can be sent, and if not why in a sentence for a person.
 *
 * Output: `{ configured: true, publicKey }` (the key a browser needs to
 * subscribe) when `HUB_VAPID_*` is set and valid; otherwise `{ configured:
 * false, reason }`, whether unset or mistaken. `cfg` is for tests and
 * defaults to the process's config. Never throws and has no side effects.
 */
export function pushStatus(cfg: PushConfig = config.push): { configured: true; publicKey: string } | { configured: false; reason: string } {
	if (cfg.state === 'on') return { configured: true, publicKey: cfg.publicKey };
	if (cfg.state === 'invalid') return { configured: false, reason: cfg.problem };
	return {
		configured: false,
		reason: 'Push is not set up on this server. Set HUB_VAPID_PUBLIC, HUB_VAPID_PRIVATE and HUB_VAPID_SUBJECT (see docs/deploy.md).'
	};
}

/**
 * Say in the log whether push is on, off or mistaken. For the server to call
 * once at boot, so a mistake in the config is seen in the journal as well as
 * in Settings. Side effect: one console line.
 */
export function announcePush(cfg: PushConfig = config.push): void {
	const status = pushStatus(cfg);
	if (status.configured) console.log('[notify] push is on');
	else if (cfg.state === 'invalid') console.error(`[notify] push is misconfigured: ${status.reason}`);
	else console.log(`[notify] push is off: ${status.reason}`);
}

/** Subscription changes run one at a time, so two devices subscribing together both land. */
let queue: Promise<unknown> = Promise.resolve();
const serially = <T>(task: () => Promise<T>): Promise<T> => {
	const run = queue.then(task, task);
	queue = run.catch(() => undefined);
	return run;
};

/** The stored devices. A missing file is none; an unreadable one is logged and read as none. */
async function load(vault: Vault): Promise<{ devices: Device[]; hash?: string }> {
	const note = await vault.read(STATE);
	if (!note.exists) return { devices: [] };
	try {
		const parsed: unknown = JSON.parse(note.content);
		const list = Array.isArray(parsed) ? parsed : [];
		return { devices: list.filter(isDevice), hash: note.hash };
	} catch (e) {
		console.error(`[notify] ${STATE} is not valid JSON; treating it as no devices`, e);
		return { devices: [], hash: note.hash };
	}
}

/** Write `devices` over what was read, retrying once against a concurrent writer from another process. */
async function store(vault: Vault, change: (devices: Device[]) => Device[]): Promise<void> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const { devices, hash } = await load(vault);
		const result = await vault.write(STATE, JSON.stringify(change(devices), null, 2) + '\n', hash);
		if (result.ok) return;
	}
	throw new Error(`could not update ${STATE}: it kept changing underneath`);
}

function isDevice(v: unknown): v is Device {
	const d = v as Device | null;
	return !!d && typeof d.endpoint === 'string' && typeof d.label === 'string' && typeof d.addedAt === 'string' && isKey(d.keys?.p256dh) && isKey(d.keys?.auth);
}

const isKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]+={0,2}$/.test(v);

/**
 * A reason this endpoint must not be posted to, or null. The server will
 * make a request to whatever address a client hands it, so it only accepts
 * public https hosts: not http, not an IP address, not a name with no dot.
 */
function endpointProblem(endpoint: string): string | null {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return 'That subscription has no usable address.';
	}
	const host = url.hostname;
	if (url.protocol !== 'https:' || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.endsWith('.local') || host.endsWith('.internal')) {
		return 'That subscription points somewhere a push service would not be.';
	}
	return null;
}

/**
 * Remember a device so pushes reach it.
 *
 * Inputs: a browser's subscription (`PushSubscription.toJSON()`, untrusted)
 * and a label such as "Chrome on Android". Output: `{ ok: true }`, or a
 * refusal (`invalid`) with a sentence when the subscription is not an https
 * endpoint with `p256dh` and `auth` keys. Idempotent by endpoint: subscribing
 * again replaces the stored keys and label, keeps `addedAt`, and never makes
 * a second entry. A blank label becomes "Unknown device"; a long one is cut.
 * Writes only `_hub/.state/push.json`.
 */
export async function subscribe(vault: Vault, subscription: unknown, label: string, now: Date = new Date()): Promise<{ ok: true } | Refused> {
	const s = subscription as Partial<PushSubscriptionJson> | null;
	if (!s || typeof s.endpoint !== 'string' || !isKey(s.keys?.p256dh) || !isKey(s.keys?.auth)) {
		return { ok: false, reason: 'invalid', message: 'That is not a push subscription.' };
	}
	const problem = endpointProblem(s.endpoint);
	if (problem) return { ok: false, reason: 'invalid', message: problem };

	const name = (typeof label === 'string' ? label : '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX) || 'Unknown device';
	const { endpoint, keys } = s as PushSubscriptionJson;
	await serially(() =>
		store(vault, (devices) => {
			const known = devices.find((d) => d.endpoint === endpoint);
			const device: Device = { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, label: name, addedAt: known?.addedAt ?? now.toISOString() };
			return known ? devices.map((d) => (d === known ? device : d)) : [...devices, device];
		})
	);
	return { ok: true };
}

/** Forget the device with this endpoint. Forgetting one that is not there is not an error. Writes only the state file, and only if something changed. */
export async function unsubscribe(vault: Vault, endpoint: string): Promise<{ ok: true }> {
	await serially(async () => {
		if ((await load(vault)).devices.some((d) => d.endpoint === endpoint)) await store(vault, (devices) => devices.filter((d) => d.endpoint !== endpoint));
	});
	return { ok: true };
}

/** The subscribed devices, oldest first, without their keys. Read-only. */
export async function devices(vault: Vault): Promise<DeviceInfo[]> {
	return (await load(vault)).devices.map(({ endpoint, label, addedAt }) => ({ endpoint, label, addedAt }));
}

/** The real sender: web-push with this server's VAPID details. Throws when push is not configured. */
function webPushSender(cfg: PushConfig): Sender {
	if (cfg.state !== 'on') throw new Error((pushStatus(cfg) as { reason: string }).reason);
	const vapidDetails = { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey };
	return async (subscription, payload, options) => {
		const mod = await import('web-push');
		const webpush = mod.default ?? mod;
		return webpush.sendNotification(subscription, payload, { ...options, vapidDetails });
	};
}

/**
 * Send one notification to every subscribed device.
 *
 * Inputs: the words (`url` must be a path on this app, starting with a
 * single `/`; anything else throws, as it is the caller's bug) and `sender`,
 * which tests pass to keep the network out; it defaults to web-push with the
 * configured VAPID details. Output: how many devices it reached (`sent`),
 * how many it could not (`failed`) and how many it dropped (`removed`). A
 * device whose push service answers 404 or 410 has gone: it is removed from
 * `push.json`. Any other failure is logged with the device's label and
 * counted, and the push is not retried. With no sender and push unconfigured,
 * every device counts as failed and the reason is logged. Side effects: the
 * network and, on removal, `push.json`. Never throws for a device's failure.
 */
export async function send(vault: Vault, note: Notification, sender?: Sender): Promise<SendResult> {
	if (!/^\/(?!\/)/.test(note.url)) throw new Error(`push url must be a path on this app, got "${note.url}"`);
	const { devices: targets } = await load(vault);
	const result: SendResult = { sent: 0, failed: 0, removed: 0 };
	if (!targets.length) return result;

	let send_: Sender;
	try {
		send_ = sender ?? webPushSender(config.push);
	} catch (e) {
		console.error(`[notify] not sent: ${(e as Error).message}`);
		return { ...result, failed: targets.length };
	}

	const payload = JSON.stringify({ title: note.title, body: note.body, url: note.url, tag: note.tag });
	const gone: string[] = [];
	await Promise.all(
		targets.map(async (d) => {
			try {
				await send_({ endpoint: d.endpoint, keys: d.keys }, payload, { TTL: TTL_SECONDS, urgency: 'high' });
				result.sent++;
			} catch (e) {
				const status = (e as { statusCode?: number }).statusCode;
				if (status === 404 || status === 410) {
					gone.push(d.endpoint);
					result.removed++;
				} else {
					result.failed++;
					console.error(`[notify] push to "${d.label}" failed${status ? ` (${status})` : ''}: ${(e as Error).message ?? e}`);
				}
			}
		})
	);
	if (gone.length) await serially(() => store(vault, (all) => all.filter((d) => !gone.includes(d.endpoint))));
	return result;
}
