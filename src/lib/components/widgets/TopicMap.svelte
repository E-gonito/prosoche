<script lang="ts">
	/**
	 * The topic map: every topic in scope, nested, with what covers it. The
	 * gaps are the point, so they are the thing the eye lands on.
	 */
	import Icon from '$lib/components/Icon.svelte';
	import Unavailable from './Unavailable.svelte';
	import type { TopicCoverage } from '$lib/client/study';
	import type { LoadedWidget } from '$lib/shared/widgets';

	let { widget }: { widget: LoadedWidget; refresh?: () => void } = $props();

	const data = $derived(widget.data as { topics: TopicCoverage[]; gaps: number; full: number } | null);
	let gapsOnly = $state(false);

	/** Depth by walking parents, so the server can stay with a flat list. */
	function depths(topics: TopicCoverage[]): Map<string, number> {
		const out = new Map<string, number>();
		for (const topic of topics) {
			const parent = topic.parent === null ? -1 : (out.get(topic.parent) ?? -1);
			out.set(topic.id, parent + 1);
		}
		return out;
	}

	const depth = $derived(data ? depths(data.topics) : new Map<string, number>());
	const shown = $derived(data ? data.topics.filter((t) => !gapsOnly || t.state === 'gap') : []);
</script>

{#if !data}
	<Unavailable {widget} />
{:else if data.topics.length === 0}
	<p class="none">No topics in scope yet. Folders and syllabus notes become topics.</p>
{:else}
	<div data-testid="topic-map">
		<div class="head">
			<span class="summary">{data.full} of {data.topics.length} covered · {data.gaps} {data.gaps === 1 ? 'gap' : 'gaps'}</span>
			<label class="only"><input type="checkbox" bind:checked={gapsOnly} data-testid="gaps-only" /> gaps only</label>
		</div>
		<ul>
			{#each shown as topic (topic.id)}
				<li data-testid="topic" data-state={topic.state} style="--depth: {Math.min(depth.get(topic.id) ?? 0, 4)}">
					<span class="dot {topic.state}" title={topic.state}></span>
					{#if topic.path}
						<a class="name" href="/notes/{topic.path}">{topic.name}</a>
					{:else}
						<span class="name">{topic.name}</span>
					{/if}
					{#if topic.total > 0}<span class="num" title="checklist">{topic.done}/{topic.total}</span>{/if}
					{#if topic.resources > 0}
						<span class="num" title="resources">{topic.resources}<Icon name="file" size={12} /></span>
					{/if}
					{#if topic.cards > 0}
						<span class="num" title="flashcards">{topic.cards}<Icon name="layers" size={12} /></span>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.head { display: flex; align-items: center; gap: var(--s2); margin-bottom: var(--s2); }
	.summary { font-size: var(--t12); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.only { margin-left: auto; flex: none; font-size: var(--t12); color: var(--muted); display: flex; align-items: center; gap: var(--s1); }
	ul { list-style: none; margin: 0; padding: 0; max-height: 340px; overflow: auto; }
	li { display: flex; align-items: center; gap: var(--s2); padding: var(--s1) 0 var(--s1) calc(var(--depth) * 14px); font-size: var(--t13); }
	.dot { flex: none; width: var(--s2); height: var(--s2); border-radius: 50%; background: var(--q4); }
	.dot.covered { background: var(--ok); }
	.dot.started { background: var(--q3); }
	.dot.gap { background: var(--line); border: 1px solid var(--q4); }
	.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); text-decoration: none; }
	a.name:hover { color: var(--accent); }
	/* `.num` is shared, in app.css: a count, with its figures lined up. */
	.num { flex: none; display: inline-flex; align-items: center; gap: 2px; font-size: var(--t11); color: var(--muted); }
	/* `.none` is shared, in app.css. */
</style>
