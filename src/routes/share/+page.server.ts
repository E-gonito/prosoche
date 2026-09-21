import { shared } from './share';
import type { PageServerLoad } from './$types';

/** The other end of the manifest's `share_target`. */
export const load: PageServerLoad = ({ url }) => {
	return { text: shared(url.searchParams) };
};
