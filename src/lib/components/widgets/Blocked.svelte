<script lang="ts">
	/**
	 * Cards waiting on another task, and what would unblock them.
	 *
	 * Shows work from other workspaces when this workspace is what holds it up,
	 * because the card that has to move is the one here (SPEC 5.5). Those are
	 * labelled with the workspace they belong to, so the list never pretends
	 * someone else's card is yours.
	 */
	import { displayText, type Task } from '$lib/shared/task';
	import Unavailable from './Unavailable.svelte';
	import type { LoadedWidget } from '$lib/shared/widgets';

	/** Produced by `src/lib/server/widgets/blocked.ts`. */
	interface BlockedData {
		items: Array<{
			task: Task;
			workspace: { slug: string; name: string; color: string } | null;
			mine: boolean;
			blockers: Array<{ id: string; task: Task | null; workspace: { slug: string; name: string; color: string } | null }>;
		}>;
		scope: string | null;
	}

	let { widget }: { widget: LoadedWidget; refresh?: () => void } = $props();
	const data = $derived((widget.data as BlockedData | null) ?? { items: [], scope: null });
	const href = (task: Task) => `/notes/${task.path.split('/').map(encodeURIComponent).join('/')}`;
</script>

{#if widget.problem || !widget.data}
	<Unavailable {widget} />
{:else if data.items.length === 0}
	<p class="empty">
		Nothing is waiting on anything{data.scope ? ` in ${data.scope}` : ''}. Add <code>⛔ id</code> to a task to
		link it to the <code>🆔 id</code> that has to finish first.
	</p>
{:else}
	<ul data-testid="blocked-widget">
		{#each data.items as item (item.task.path + ':' + item.task.line)}
			<li class:foreign={!item.mine}>
				<div class="head">
					{#if item.task.quadrant}<span class="q q{item.task.quadrant}">Q{item.task.quadrant}</span>{/if}
					<a href={href(item.task)}>{displayText(item.task.text)}</a>
					{#if item.workspace && !item.mine}
						<span class="chip"><span class="dot" style="--dot: {item.workspace.color}"></span>{item.workspace.name}</span>
					{/if}
				</div>
				<ul class="blockers">
					{#each item.blockers as blocker (blocker.id)}
						<li>
							{#if blocker.task}
								waiting on <a href={href(blocker.task)}>{displayText(blocker.task.text)}</a>
								{#if blocker.workspace}<span class="muted">· {blocker.workspace.name}</span>{/if}
								<span class="muted">· {blocker.task.status === 'done' ? 'done, this can start' : blocker.task.status}</span>
							{:else}
								waiting on <code>{blocker.id}</code>, which no task in the vault carries
							{/if}
						</li>
					{/each}
				</ul>
			</li>
		{/each}
	</ul>
{/if}

<style>
	ul { list-style: none; margin: 0; padding: 0; }
	li { padding: 7px 2px; border-top: 1px solid var(--line); }
	li:first-child { border-top: 0; }
	.head { display: flex; align-items: baseline; gap: 6px; }
	.head a { text-decoration: none; flex: 1; min-width: 0; }
	.head a:hover { text-decoration: underline; }
	.foreign { opacity: 0.85; }
	.chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); flex: none; }
	.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dot); }
	.blockers { margin: 2px 0 0 0; font-size: 12px; color: var(--muted); }
	.blockers li { border: 0; padding: 1px 0; }
	.muted { color: var(--muted); }
	.empty { color: var(--muted); font-size: 13px; padding: 8px 0; }
	code { font: 11px var(--mono); background: var(--soft); border-radius: 4px; padding: 1px 4px; }
</style>
