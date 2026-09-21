import { redirect } from '@sveltejs/kit';
import { today } from '$server/daily';
import type { PageServerLoad } from './$types';

// `/` always means today, so a bookmarked hub opens on the current day.
export const load: PageServerLoad = ({ url }) => {
	const day = url.searchParams.get('day');
	redirect(307, `/day/${day ?? today()}`);
};
