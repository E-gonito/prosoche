/**
 * Light or dark: which theme the app is drawn in, and the switch between them.
 *
 * The choice belongs to the device, not the vault, so it lives in
 * localStorage under `STORAGE_KEY`. Until the user presses the button the app
 * follows the device's own setting, and keeps following it if that changes;
 * once they have chosen, their choice wins on this device from then on.
 *
 * The theme is the `data-theme` attribute on <html>, which `src/app.css`
 * reads. The script in `src/app.html` sets it before the first paint, so a
 * dark page never flashes white; this module takes over once the app is
 * running. The two must agree on `STORAGE_KEY` and on the theme colours.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'hub:theme';

/** The browser bar's colour per theme: the page's own paper. */
const BAR: Record<Theme, string> = { light: '#ffffff', dark: '#1b1916' };

const DEVICE_DARK = '(prefers-color-scheme: dark)';

function stored(): Theme | null {
	const value = localStorage.getItem(STORAGE_KEY);
	return value === 'light' || value === 'dark' ? value : null;
}

function apply(theme: Theme) {
	document.documentElement.dataset.theme = theme;
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[theme]);
}

class ThemeState {
	/**
	 * The theme on screen. 'light' until `start` runs, because the server
	 * cannot know the device's setting and the first render must match it.
	 */
	current = $state<Theme>('light');

	/**
	 * Read the theme the head script applied and follow the device's setting
	 * for as long as the user has not chosen. Call once, from the layout, after
	 * mounting. Returns the function that stops following.
	 */
	start(): () => void {
		const device = matchMedia(DEVICE_DARK);
		const follow = () => {
			if (stored()) return;
			this.current = device.matches ? 'dark' : 'light';
			apply(this.current);
		};
		this.current = stored() ?? (device.matches ? 'dark' : 'light');
		apply(this.current);
		device.addEventListener('change', follow);
		return () => device.removeEventListener('change', follow);
	}

	/** Switch to the other theme and remember it on this device. */
	toggle() {
		this.current = this.current === 'dark' ? 'light' : 'dark';
		localStorage.setItem(STORAGE_KEY, this.current);
		apply(this.current);
	}
}

/** The one theme. */
export const theme = new ThemeState();
