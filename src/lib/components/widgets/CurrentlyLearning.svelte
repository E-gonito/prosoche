<script lang="ts">
	/**
	 * Things the user is part way through. Reusable anywhere: the data comes
	 * from the widget's own scope, so this component never asks what page it
	 * is on.
	 */
	import Unavailable from './Unavailable.svelte';
	import { setResourceStatus, type Resource } from '$lib/client/study';
	import type { LoadedWidget } from '$lib/shared/widgets';

	let { widget, refresh }: { widget: LoadedWidget; refresh?: () => void } = $props();

	interface Data {
		items: Resource[];
		learning: number;
		queued: number;
		paused: number;
		done: number;
	}
	const data = $derived(widget.data as Data | null);
	let problem = $state('');
	let busy = $state('');

	const ICON: Record<string, string> = {
		course: '🎓',
		book: '📕',
		article: '📄',
		video: '▶',
		lab: '🧪',
		paper: '📜',
		note: '📝'
	};

	async function move(resource: Resource, status: Resource['status']) {
		busy = resource.path;
		const result = await setResourceStatus(resource.path, status);
		busy = '';
		if (result.ok) refresh?.();
		else problem = result.message;
	}
</script>

{#if !data}
	<Unavailable {widget} />
{:else}
	<div data-testid="currently-learning">
		{#if data.items.length === 0}
			<p class="none">Nothing on the go. {data.queued} waiting in the queue.</p>
		{:else}
			<ul>
				{#each data.items as item (item.path)}
					<li data-testid="learning-item" class:busy={busy === item.path}>
						<span class="ic" title={item.kind}>{ICON[item.kind] ?? '📝'}</span>
						<a class="name" href="/notes/{item.path}" title={item.title}>{item.title}</a>
						<span class="bar" aria-label="{item.progress}% done"><i style="width: {item.progress}%"></i></span>
						<button class="btn ghost done" data-testid="finish" onclick={() => move(item, 'done')} title="Mark finished">✓</button>
					</li>
				{/each}
			</ul>
		{/if}
		<p class="hint">{data.learning} learning · {data.queued} queued · {data.done} done</p>
		{#if problem}<p class="problem">{problem}</p>{/if}
	</div>
{/if}

<style>
	ul { list-style: none; margin: 0; padding: 0; }
	li { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--line); }
	li:first-child { border-top: 0; }
	.busy { opacity: 0.5; }
	.ic { flex: none; width: 16px; text-align: center; }
	.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); text-decoration: none; }
	.name:hover { color: var(--accent); }
	.bar { flex: none; width: 54px; height: 5px; border-radius: 3px; background: var(--soft); overflow: hidden; }
	.bar i { display: block; height: 100%; background: var(--accent); }
	.done { flex: none; padding: 2px 6px; font-size: 12px; }
	.none { margin: 0; color: var(--muted); font-size: 13px; }
	.problem { color: var(--bad); font-size: 12px; margin: 6px 0 0; }
	@media (max-width: 720px) {
		.bar { width: 36px; }
	}
</style>
