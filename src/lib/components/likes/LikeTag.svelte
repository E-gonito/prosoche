<script lang="ts" generics="T extends string | boolean">
	/**
	 * One tag on a like, as a row of chips: `?` for unknown, then each value.
	 * Tapping the chip that is on turns it back to unknown, so a wrong tap is
	 * one more tap to undo. Unknown is its own answer here, never "no".
	 */
	let {
		label,
		value = $bindable(null),
		options,
		testid
	}: { label: string; value: T | null; options: Array<{ value: T; label: string }>; testid: string } = $props();
</script>

<div class="tag" role="group" aria-label={label} data-testid={testid}>
	<span class="name">{label}</span>
	<div class="chips">
		<button type="button" class="chip" class:on={value === null} aria-pressed={value === null} onclick={() => (value = null)}>?</button>
		{#each options as o (String(o.value))}
			<button
				type="button"
				class="chip"
				class:on={value === o.value}
				aria-pressed={value === o.value}
				data-value={String(o.value)}
				onclick={() => (value = value === o.value ? null : o.value)}>{o.label}</button
			>
		{/each}
	</div>
</div>

<style>
	.tag { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); flex-wrap: wrap; }
	.name { font-weight: 600; font-size: var(--t14); }
	.chip { min-height: 36px; min-width: 44px; justify-content: center; }
</style>
