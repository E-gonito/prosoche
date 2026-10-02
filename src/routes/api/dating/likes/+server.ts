import { json, type RequestHandler } from '@sveltejs/kit';
import { addLike, exportLikes, updateLike } from '$server/dating';
import { hub } from '$server/hub';
import { refuse, route, str } from '../../route';

/**
 * Likes sent. POST logs one: `{ label, sentDate?, forecast, outOfLeague?,
 * fitsType?, age?, likedOn?, commented? }`, answering `{ like }`. PUT edits
 * one: `{ label, expectedHash, fields?, status? }` (see `updateLike`). GET
 * downloads every record as JSON (see `exportLikes`).
 */
export const POST = route(
	async ({ body, hub }) => {
		const label = str(body.label);
		if (!label) return refuse('no-name', 'Give her a nickname.');
		return addLike(hub.vault, { ...body, label, forecast: body.forecast as number, sentDate: str(body.sentDate) || undefined });
	},
	{ exists: 'That nickname is already taken. Add something to tell them apart.', invalid: 'The forecast or a tag could not be read.' }
);

export const PUT = route(async ({ body, hub }) => {
	const label = str(body.label);
	const expectedHash = str(body.expectedHash);
	if (!label || !expectedHash) return refuse('invalid', 'label and expectedHash are required');
	return updateLike(hub.vault, label, { fields: body.fields as object | undefined, status: body.status as never }, expectedHash);
});

export const GET: RequestHandler = async () => {
	const data = await exportLikes((await hub()).vault);
	return json(data, { headers: { 'content-disposition': `attachment; filename="likes-${data.exported}.json"` } });
};
