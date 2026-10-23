/// <reference lib="webworker" />

/**
 * Shows a push and opens its link when tapped. That is all it does.
 *
 * It caches nothing and has no `fetch` handler, so every request goes to the
 * network exactly as if it were not here: a stale page can never be served
 * from this file. Its only purpose is that a browser delivers a push to a
 * service worker and to nothing else.
 *
 * A push is the JSON `{ title, body, url, tag }` that `server/notify.ts`
 * sends. `url` is a path on this app.
 */

const sw = self as unknown as ServiceWorkerGlobalScope;

interface Payload {
	title: string;
	body: string;
	url: string;
	tag: string;
}

/** Take over as soon as installed, so a new version handles the next push rather than the one after. */
sw.addEventListener('install', () => void sw.skipWaiting());
sw.addEventListener('activate', (event) => event.waitUntil(sw.clients.claim()));

sw.addEventListener('push', (event) => {
	const note = readPayload(event);
	event.waitUntil(
		sw.registration.showNotification(note.title, {
			body: note.body,
			tag: note.tag,
			data: { url: note.url },
			// `renotify` is not in the DOM typings yet; it makes a repeated tag buzz again.
			...({ renotify: true } as object),
			icon: '/icon-192.png',
			badge: '/icon-192.png'
		})
	);
});

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = new URL(String(event.notification.data?.url ?? '/'), sw.location.origin).href;
	event.waitUntil(open(url));
});

/** What the push said. A push with no readable payload still shows something, since the browser requires every push to show a notification. */
function readPayload(event: PushEvent): Payload {
	try {
		const p = event.data?.json() as Partial<Payload> | undefined;
		return { title: p?.title || 'prosoche', body: p?.body ?? '', url: p?.url || '/', tag: p?.tag || 'prosoche' };
	} catch {
		return { title: 'prosoche', body: event.data?.text() ?? '', url: '/', tag: 'prosoche' };
	}
}

/** Show `url` in a window of this app that is already open, else in a new one. */
async function open(url: string): Promise<void> {
	const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
	for (const client of windows) {
		try {
			// `navigate` refuses a window this worker does not control; fall through to a new one.
			const moved = await client.navigate(url);
			await (moved ?? client).focus();
			return;
		} catch {
			continue;
		}
	}
	await sw.clients.openWindow(url);
}
