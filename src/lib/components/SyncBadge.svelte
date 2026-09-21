<script lang="ts">
	// Shows how fresh the server's copy of the vault is. Staleness is visible
	// rather than silent, because the user's Mac may only pull occasionally.
	type Status = {
		provider: string;
		pending: string[];
		conflicts: string[];
		lastPull: string | null;
		lastPush: string | null;
		error: string | null;
		busy: boolean;
	};

	let status = $state<Status | null>(null);

	async function refresh() {
		try {
			status = await (await fetch('/api/sync')).json();
		} catch {
			status = null;
		}
	}

	$effect(() => {
		refresh();
		const timer = setInterval(refresh, 30_000);
		return () => clearInterval(timer);
	});

	function ago(iso: string | null): string {
		if (!iso) return 'never';
		const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
		if (seconds < 60) return 'just now';
		if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
		if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
		return `${Math.round(seconds / 86400)} d ago`;
	}

	/** One readable line; git errors arrive as several. */
	const summary = $derived(
		status?.error ? status.error.split('\n')[0].slice(0, 120) : 'Vault sync status'
	);

	const tone = $derived(
		!status ? 'unknown' : status.error || status.conflicts.length ? 'bad' : status.pending.length ? 'warn' : 'ok'
	);
</script>

<a class="badge {tone}" href="/sync" title={summary}>
	<i></i>
	{#if !status}
		checking…
	{:else if status.conflicts.length}
		{status.conflicts.length} conflict{status.conflicts.length === 1 ? '' : 's'}
	{:else if status.error}
		sync error
	{:else}
		pulled {ago(status.lastPull)}{#if status.pending.length}, {status.pending.length} pending{/if}
	{/if}
</a>

<style>
	.badge {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		color: var(--muted);
		text-decoration: none;
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 3px 10px;
	}
	.badge:hover { background: var(--soft); }
	i { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
	.ok i { background: var(--ok); }
	.warn i { background: var(--q3); }
	.bad i { background: var(--bad); }
</style>
