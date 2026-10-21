import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { contentType, imageFile } from '$server/cute';
import type { RequestHandler } from './$types';

/**
 * One image file from `Cute/images/`, by name. Nothing else in the vault can
 * be reached through here: a name with a path in it, or a file that is not a
 * PNG, JPEG, GIF or WebP by its bytes, is a 404. The type sent is the one the
 * bytes say, never the name's, and `nosniff` stops the browser guessing.
 */
export const GET: RequestHandler = async ({ params }) => {
	const { vault } = await hub();
	const found = await imageFile(vault, params.file);
	if (!found) error(404, 'No such image');
	return new Response(found.bytes as BodyInit, {
		headers: {
			'content-type': contentType(found.type),
			'x-content-type-options': 'nosniff',
			// A filed image's name is never reused, so it can be cached for good.
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
