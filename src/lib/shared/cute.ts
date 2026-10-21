/**
 * The Cute tab's vocabulary, shared by its pages and its routes: where an
 * image is served from, and the one shape a picture takes on a page.
 */

/** The address of an image file in `Cute/images/`. */
export function cuteMediaHref(name: string): string {
	return `/cute/media/${encodeURIComponent(name)}`;
}

/** A picture to draw: its address, and whether it is an animated-capable GIF. */
export interface Picture {
	src: string;
	/** Shown under it in the viewer: the file name, or the web address. */
	label: string;
	gif: boolean;
	/** True for a picture on the web rather than in the vault. */
	remote: boolean;
}
