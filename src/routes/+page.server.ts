import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// `/` always means Today, so a bookmark opens on the current day.
export const load: PageServerLoad = () => {
	redirect(307, '/today');
};
