<script module lang="ts">
	/**
	 * Every icon the app draws, and the one component that draws them.
	 *
	 * The shapes are hand-copied from the Lucide icon set (ISC licence,
	 * https://lucide.dev), not installed: a dependency for two dozen glyphs
	 * would pull a whole build step and a tree-shaking problem in behind it.
	 * Each icon is one or more `path` commands on Lucide's 24×24 grid, so a
	 * circle or a line is written as a path rather than as its own element.
	 * That keeps the renderer a single `{#each}` instead of a shape dispatch,
	 * and it is why `ban` and `circle` look like arcs below.
	 *
	 * An icon is decoration unless it is told otherwise. Passing `label` is the
	 * only way to make a screen reader announce one, so an icon sitting beside
	 * its own text can never say that text twice.
	 */

	/** The name of every icon. A name not in here will not compile. */
	export const ICON_NAMES = [
		'alert-triangle',
		'arrow-up-down',
		'ban',
		'book',
		'calendar',
		'check',
		'check-square',
		'chevron-down',
		'chevron-left',
		'chevron-right',
		'circle',
		'external-link',
		'file',
		'file-text',
		'flame',
		'flask',
		'graduation-cap',
		'layers',
		'menu',
		'more-horizontal',
		'play',
		'plus',
		'refresh',
		'scroll',
		'search',
		'settings',
		'sparkles',
		'video',
		'x'
	] as const;

	export type IconName = (typeof ICON_NAMES)[number];

	const PATHS: Record<IconName, string[]> = {
		'alert-triangle': [
			'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z',
			'M12 9v4',
			'M12 17h.01'
		],
		'arrow-up-down': ['m21 16-4 4-4-4', 'M17 20V4', 'm3 8 4-4 4 4', 'M7 4v16'],
		ban: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z', 'm4.93 4.93 14.14 14.14'],
		book: ['M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20'],
		calendar: [
			'M8 2v4',
			'M16 2v4',
			'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
			'M3 10h18'
		],
		check: ['M20 6 9 17l-5-5'],
		'check-square': ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'm9 12 2 2 4-4'],
		'chevron-down': ['m6 9 6 6 6-6'],
		'chevron-left': ['m15 18-6-6 6-6'],
		'chevron-right': ['m9 18 6-6-6-6'],
		circle: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'],
		'external-link': ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
		file: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z', 'M14 2v4a2 2 0 0 0 2 2h4'],
		'file-text': [
			'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z',
			'M14 2v4a2 2 0 0 0 2 2h4',
			'M10 9H8',
			'M16 13H8',
			'M16 17H8'
		],
		flame: [
			'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z'
		],
		flask: [
			'M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2',
			'M6.45 15h11.1',
			'M8.5 2h7'
		],
		'graduation-cap': [
			'M21.42 10.92a1 1 0 0 0-.02-1.84L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.84l8.57 3.9a2 2 0 0 0 1.66 0z',
			'M22 10v6',
			'M6 12.5V16a6 3 0 0 0 12 0v-3.5'
		],
		layers: [
			'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.91a1 1 0 0 0 0-1.83z',
			'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65',
			'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65'
		],
		menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
		'more-horizontal': [
			'M13 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0z',
			'M20 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0z',
			'M6 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0z'
		],
		play: ['M6 3 20 12 6 21z'],
		plus: ['M5 12h14', 'M12 5v14'],
		refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
		scroll: [
			'M19 17V5a2 2 0 0 0-2-2H4',
			'M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3'
		],
		search: ['M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z', 'm21 21-4.35-4.35'],
		settings: [
			'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
			'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'
		],
		sparkles: [
			'M11.52 2.37a.5.5 0 0 1 .96 0l1.58 6.13A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0l-1.58-6.13A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94a2 2 0 0 0 1.44-1.44z',
			'M20 3v4',
			'M22 5h-4',
			'M4 17v2',
			'M5 18H3'
		],
		video: ['M16 10l4.55-2.28A1 1 0 0 1 22 8.62v6.76a1 1 0 0 1-1.45.89L16 14z', 'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z'],
		x: ['M18 6 6 18', 'm6 6 12 12']
	};
</script>

<script lang="ts">
	let {
		name,
		size = 16,
		label = undefined
	}: {
		name: IconName;
		/** Drawn square, at this many CSS pixels. */
		size?: number;
		/** What a screen reader should call it. Absent means decorative. */
		label?: string;
	} = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	{#each PATHS[name] as d (d)}<path {d} />{/each}
</svg>

<style>
	svg {
		flex: none;
		display: block;
	}
</style>
