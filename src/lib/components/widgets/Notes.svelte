<script lang="ts">
	/**
	 * The workspace's notes, most recently changed first.
	 *
	 * A list rather than a tree: the tree already exists on the Notes page, and
	 * what a workspace tab is for is "what have I touched lately".
	 */
	import Unavailable from './Unavailable.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import type { LoadedWidget } from '$lib/shared/widgets';

	/** Produced by `src/lib/server/widgets/notes.ts`. */
	interface NotesData {
		notes: Array<{ path: string; title: string; mtimeMs: number; preview: string }>;
		folders: string[];
		total: number;
	}

	let { widget }: { widget: LoadedWidget; refresh?: () => void } = $props();
	const data = $derived((widget.data as NotesData | null) ?? { notes: [], folders: [], total: 0 });
	const href = (path: string) => `/notes/${path.split('/').map(encodeURIComponent).join('/')}`;
</script>

{#if widget.problem || !widget.data}
	<Unavailable {widget} />
{:else if data.notes.length === 0}
	{#if data.folders.length}
		<EmptyState icon="file-text" title="No notes in {data.folders.join(', ')} yet." />
	{:else}
		<EmptyState
			icon="file-text"
			title="This workspace has no folders yet."
			hint="Add a folders: list to its workspace file."
		/>
	{/if}
{:else}
	<ul data-testid="notes-widget">
		{#each data.notes as note (note.path)}
			<li>
				<a href={href(note.path)}>{note.title}</a>
				<span class="when">{shortDate(note.mtimeMs)}</span>
				<span class="where">{note.path}</span>
			</li>
		{/each}
	</ul>
	<p class="hint">{data.notes.length} of {data.total} in {data.folders.join(', ') || 'the vault'}.</p>
{/if}

<script lang="ts" module>
	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

	/** Fixed format rather than a locale, so server and browser agree. */
	function shortDate(ms: number): string {
		const date = new Date(ms);
		return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
	}
</script>

<style>
	ul { list-style: none; margin: 0; padding: 0; }
	li { display: flex; align-items: baseline; gap: 8px; padding: 6px 2px; border-top: 1px solid var(--line); }
	li:first-child { border-top: 0; }
	a { text-decoration: none; flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	a:hover { text-decoration: underline; }
	.when { font: 11px var(--mono); color: var(--muted); flex: none; }
	.where { font-size: 11px; color: var(--muted); margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.hint { font-size: 12px; color: var(--muted); margin: 8px 0 0; }

	@media (max-width: 720px) {
		.where { display: none; }
		a { max-width: none; }
	}
</style>
