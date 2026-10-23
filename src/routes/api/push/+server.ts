import { devices, pushStatus, send, subscribe, unsubscribe } from '$server/notify';
import { refuse, route, str } from '../route';

/** What the state of push is, and which devices would be told. `status.configured` is false, with a `reason`, when the server has no VAPID keys. */
export const GET = route(async ({ hub }) => ({ status: pushStatus(), devices: await devices(hub.vault) }));

/**
 * Manage this server's push devices. `{ action: 'subscribe', subscription,
 * label }` remembers a browser's `PushSubscription.toJSON()`;
 * `{ action: 'unsubscribe', endpoint }` forgets it; `{ action: 'test' }` sends
 * "Notifications work" (opening `/today`) to every device and answers `{ sent,
 * failed, removed }`. Subscribing and testing are refused when push is not
 * configured, since a subscription made without the server's key could not
 * be used.
 */
export const POST = route(async ({ body, hub }) => {
	const status = pushStatus();
	switch (body.action) {
		case 'subscribe':
			if (!status.configured) return refuse('not-configured', status.reason);
			return subscribe(hub.vault, body.subscription, str(body.label) ?? '');
		case 'unsubscribe': {
			const endpoint = str(body.endpoint);
			return endpoint ? unsubscribe(hub.vault, endpoint) : refuse('invalid', 'Say which device to remove.');
		}
		case 'test':
			if (!status.configured) return refuse('not-configured', status.reason);
			return send(hub.vault, { title: 'Notifications work', body: 'This is a test from prosoche.', url: '/today', tag: 'test' });
		default:
			return refuse('invalid', 'action must be subscribe, unsubscribe or test');
	}
});
