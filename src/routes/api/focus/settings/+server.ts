import { setFocusSettings } from '$server/focus/settings';
import { route } from '../../route';

/**
 * Change the focus settings. `{ warmupMin?, windDownMin?, followUpMin?, planBy? }`:
 * whole minutes from 1 to 60, and `planBy` as `HH:MM`. Only the fields sent
 * change. Answers the settings as written (`warmupMin`, `rules`, `planByMin`).
 */
export const POST = route(({ body, hub }) => setFocusSettings(hub.vault, body), {
	invalid: 'Minutes are whole numbers from 1 to 60, and the time is HH:MM, like 10:00.'
});
