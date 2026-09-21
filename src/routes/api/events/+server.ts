import { hub } from '$server/hub';
import type { RequestHandler } from './$types';

/**
 * Server-sent events carrying vault changes, so an open page updates when a
 * pull or another device brings in new content.
 */
export const GET: RequestHandler = async () => {
	const { subscribe } = hub();

	let unsubscribe = () => {};
	let heartbeat: NodeJS.Timeout;

	const stream = new ReadableStream({
		start(controller) {
			const send = (event: string, data: unknown) => {
				try {
					controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
				} catch {
					// Client vanished between the change and the write.
				}
			};
			send('hello', { at: new Date().toISOString() });
			unsubscribe = subscribe((change) => send('change', change));
			// Keeps intermediaries from closing an idle connection.
			heartbeat = setInterval(() => send('ping', {}), 25_000);
		},
		cancel() {
			unsubscribe();
			clearInterval(heartbeat);
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
