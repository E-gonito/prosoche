<script lang="ts">
	/**
	 * Things the user is part way through. Reusable anywhere: the data comes
	 * from the widget's own scope, so this component never asks what page it
	 * is on.
	 */
	import Icon, { type IconName } from '$lib/components/Icon.svelte';
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

	/** What each kind of resource looks like. An unknown kind reads as a note. */
	const ICON: Record<string, IconName> = {
		course: 'graduation-cap',
		book: 'book',
		article: 'file-text',
		video: 'video',
		lab: 'flask',
		paper: 'scroll',
		note: 'file-text'
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
						<div class="row">
							<span class="ic" title={item.kind}><Icon name={ICON[item.kind] ?? 'file-text'} /></span>
							<a class="name" href="/notes/{item.path}" title={item.title}>{item.title}</a>
							<button class="btn ghost done" data-testid="finish" onclick={() => move(item, 'done')} title="Mark finished">
								<Icon name="check" label="Mark finished" />
							</button>
						</div>
						<span class="bar" aria-label="{item.progress}% done"><i style="width: {item.progress}%"></i></span>
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
	li { padding: 6px 0; border-top: 1px solid var(--line); }
	li:first-child { border-top: 0; }
	.busy { opacity: 0.5; }
	/* Title on its own line, so a name past thirty characters gets the whole
	   card's width instead of what the bar and button left over. */
	.row { display: flex; align-items: center; gap: 8px; }
	.ic { flex: none; display: inline-flex; color: var(--muted); }
	.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); text-decoration: none; }
	.name:hover { color: var(--accent); }
	.bar { display: block; width: 100%; height: 5px; border-radius: 3px; background: var(--soft); overflow: hidden; margin-top: 6px; }
	.bar i { display: block; height: 100%; background: var(--accent); }
	.done { flex: none; padding: 3px 6px; }
	.none { margin: 0; color: var(--muted); font-size: 13px; }
	.problem { color: var(--bad); font-size: 12px; margin: 6px 0 0; }
</style>
