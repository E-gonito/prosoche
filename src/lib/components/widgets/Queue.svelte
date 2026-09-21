<script lang="ts">
	/**
	 * What to read or watch next. The order is the server's, stated on
	 * `queue()`; this component renders it and offers the one action that
	 * changes it, which is starting something.
	 */
	import Unavailable from './Unavailable.svelte';
	import { setResourceStatus, type Resource } from '$lib/client/study';
	import type { LoadedWidget } from '$lib/shared/widgets';

	let { widget, refresh }: { widget: LoadedWidget; refresh?: () => void } = $props();

	const data = $derived(widget.data as { items: Resource[]; total: number } | null);
	let problem = $state('');
	let busy = $state('');

	async function start(resource: Resource) {
		busy = resource.path;
		const result = await setResourceStatus(resource.path, 'learning');
		busy = '';
		if (result.ok) refresh?.();
		else problem = result.message;
	}
</script>

{#if !data}
	<Unavailable {widget} />
{:else if data.items.length === 0}
	<p class="none">Nothing queued. Capture a link and it lands here.</p>
{:else}
	<div data-testid="queue">
		<ol>
			{#each data.items as item (item.path)}
				<li data-testid="queue-item" class:busy={busy === item.path}>
					<a class="name" href="/notes/{item.path}" title={item.title}>{item.title}</a>
					{#if item.url}<a class="src" href={item.url} target="_blank" rel="noreferrer" title="Open the original">↗</a>{/if}
					{#if item.status === 'queued'}
						<button class="btn ghost" data-testid="start" onclick={() => start(item)}>Start</button>
					{:else}
						<span class="tag">learning</span>
					{/if}
				</li>
			{/each}
		</ol>
		{#if data.total > data.items.length}<p class="hint">{data.total - data.items.length} more waiting.</p>{/if}
		{#if problem}<p class="problem">{problem}</p>{/if}
	</div>
{/if}

<style>
	ol { list-style: decimal inside; margin: 0; padding: 0; }
	li { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--line); }
	li:first-child { border-top: 0; }
	.busy { opacity: 0.5; }
	.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); text-decoration: none; }
	.name:hover { color: var(--accent); }
	.src { flex: none; color: var(--muted); text-decoration: none; }
	.none { margin: 0; color: var(--muted); font-size: 13px; }
	.problem { color: var(--bad); font-size: 12px; margin: 6px 0 0; }
	button { flex: none; padding: 2px 8px; font-size: 12px; }
</style>
