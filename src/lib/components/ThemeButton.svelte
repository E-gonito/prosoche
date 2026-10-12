<script lang="ts">
	/**
	 * The dark-mode switch: a moon that turns the lights off, a sun that turns
	 * them back on. A toggle button, so a screen reader hears "Dark mode,
	 * pressed" rather than a label that flips with every press.
	 */
	import Icon from '$lib/components/Icon.svelte';
	import { theme } from '$lib/client/theme.svelte';

	let { size = 16 }: { size?: number } = $props();

	const dark = $derived(theme.current === 'dark');
</script>

<button
	class="icon-btn"
	onclick={() => theme.toggle()}
	aria-label="Dark mode"
	aria-pressed={dark}
	title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
	data-testid="theme"
>
	<Icon name={dark ? 'sun' : 'moon'} {size} />
</button>
