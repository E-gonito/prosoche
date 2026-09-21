<script lang="ts">
	/**
	 * Anything tagged `#pin`, and one click to unpin it.
	 *
	 * Unpinning here writes the same single-line edit the rest of the app does,
	 * so a pin removed in the hub is a pin removed in Obsidian.
	 */
	import { displayText, type Task } from '$lib/shared/task';
	import { editTask } from '$lib/client/api';
	import Unavailable from './Unavailable.svelte';
	import type { LoadedWidget } from '$lib/shared/widgets';

	/** Produced by `src/lib/server/widgets/pinned.ts`. */
	interface PinnedData {
		items: Array<{ task: Task; workspace: { slug: string; name: string; color: string } | null }>;
		scope: string | null;
		tag: string;
	}

	let { widget, refresh }: { widget: LoadedWidget; refresh?: () => void } = $props();
	const data = $derived((widget.data as PinnedData | null) ?? { items: [], scope: null, tag: 'pin' });

	let unpinned = $state(new Set<string>());
	let problem = $state('');
	let busy = $state('');

	const key = (task: Task) => `${task.path}:${task.line}`;
	const items = $derived(data.items.filter((item) => !unpinned.has(key(item.task))));
	const href = (task: Task) => `/notes/${task.path.split('/').map(encodeURIComponent).join('/')}`;

	async function unpin(task: Task) {
		busy = key(task);
		const result = await editTask(task, { removeTags: [data.tag] });
		busy = '';
		if (!result.ok) {
			problem = result.message;
			return;
		}
		unpinned = new Set(unpinned).add(key(task));
		refresh?.();
	}
</script>

{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

{#if widget.problem || !widget.data}
	<Unavailable {widget} />
{:else if items.length === 0}
	<p class="empty">Nothing pinned{data.scope ? ` in ${data.scope}` : ''}. Add <code>#{data.tag}</code> to a task to keep it here.</p>
{:else}
	<ul data-testid="pinned-widget">
		{#each items as item (key(item.task))}
			<li>
				{#if item.task.quadrant}<span class="q q{item.task.quadrant}">Q{item.task.quadrant}</span>{/if}
				<a href={href(item.task)}>{displayText(item.task.text)}</a>
				{#if item.workspace && !data.scope}
					<span class="chip"><span class="dot" style="--dot: {item.workspace.color}"></span>{item.workspace.name}</span>
				{/if}
				<button
					class="btn ghost"
					data-testid="unpin"
					disabled={busy === key(item.task)}
					aria-label="Unpin {displayText(item.task.text)}"
					onclick={() => unpin(item.task)}
				>Unpin</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	ul { list-style: none; margin: 0; padding: 0; }
	li { display: flex; align-items: baseline; gap: 6px; padding: 6px 2px; border-top: 1px solid var(--line); }
	li:first-child { border-top: 0; }
	a { text-decoration: none; flex: 1; min-width: 0; }
	a:hover { text-decoration: underline; }
	.chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); flex: none; }
	.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dot); }
	.btn { flex: none; font-size: 12px; padding: 2px 6px; }
	.problem { margin: 0 0 6px; font-size: 12px; color: var(--bad); }
	.empty { color: var(--muted); font-size: 13px; padding: 8px 0; }
	code { font: 11px var(--mono); background: var(--soft); border-radius: 4px; padding: 1px 4px; }
</style>
