import { hub } from '$server/hub';
import { listBooks } from '$server/books/library';
import type { PageServerLoad } from './$types';

/** Every book with a note, newest read first, and the bytes free on the shelf's disk. Never writes. */
export const load: PageServerLoad = async () => {
	const { vault, shelf } = await hub();
	return { books: await listBooks(vault, shelf), free: await shelf.free() };
};
