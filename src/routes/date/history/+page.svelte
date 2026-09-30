<script lang="ts">
	/** History: every logged day, newest first. A day opens on Log to edit it. */
	let { data } = $props();
</script>

<svelte:head><title>History · Date · prosoche</title></svelte:head>

<div class="sheet rows" data-testid="dating-history">
	{#each data.days as d (d.day)}
		<a class="day-row" href="/date?day={d.day}" data-testid="dating-history-day">
			<span class="date">{d.day}</span>
			<span class="counts">
				<span class="num"><b>{d.sent}</b> sent</span>
				<span class="num"><b>{d.matches}</b> matches</span>
				<span class="num"><b>{d.type}</b> type</span>
				<span class="num"><b>{d.received}</b> received</span>
			</span>
			{#if d.notes}<span class="notes muted small">{d.notes}</span>{/if}
		</a>
	{:else}
		<p class="empty">Nothing logged yet.</p>
	{/each}
</div>

<style>
	.day-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--s3);
		color: var(--text);
	}
	.day-row:hover { text-decoration: none; background: var(--soft); }
	.date { font-weight: 600; min-width: 96px; }
	.counts { display: flex; gap: var(--s3); font-size: var(--t13); color: var(--muted); }
	.counts b { color: var(--text); }
	.notes { flex-basis: 100%; }
</style>
