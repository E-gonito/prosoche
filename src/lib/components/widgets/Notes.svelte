<script lang="ts">
	/**
	 * The workspace's notes, most recently changed first.
	 *
	 * A list rather than a tree: the tree already exists on the Notes page, and
	 * what a workspace tab is for is "what have I touched lately". Grouped by
	 * subfolder — the server has already worked out which group each note is
	 * in, so this only draws a heading when the group changes.
	 */
	import Unavailable from './Unavailable.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { relativeDay } from '$lib/shared/time';
	import type { LoadedWidget } from '$lib/shared/widgets';

	/** Produced by `src/lib/server/widgets/notes.ts`. */
	interface NotesData {
		notes: Array<{ path: string; title: string; subtitle: string; day: string; group: string }>;
		folders: string[];
		total: number;
		today: string;
	}

	let { widget }: { widget: LoadedWidget; refresh?: () => void } = $props();
	const data = $derived((widget.data as NotesData | null) ?? { notes: [], folders: [], total: 0, today: '' });
	const href = (path: string) => `/notes/${path.split('/').map(encodeURIComponent).join('/')}`;

	/** A heading is due when this is the first row of a new, named group. */
	const startsGroup = (i: number): boolean =>
		Boolean(data.notes[i].group) && data.notes[i - 1]?.group !== data.notes[i].group;
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
		{#each data.notes as note, i (note.path)}
			{#if startsGroup(i)}
				<li class="group"><h6>{note.group}</h6></li>
			{/if}
			<li>
				<a href={href(note.path)}>{note.title}</a>
				{#if note.subtitle}<span class="subtitle">{note.subtitle}</span>{/if}
				<span class="when">{relativeDay(note.day, data.today)}</span>
			</li>
		{/each}
	</ul>
	<p class="hint">{data.notes.length} of {data.total} in {data.folders.join(', ') || 'the vault'}.</p>
{/if}

<style>
	ul { list-style: none; margin: 0; padding: 0; }
	li { display: flex; align-items: baseline; gap: var(--s2); padding: 6px 2px; border-top: 1px solid var(--line); }
	li:first-child { border-top: 0; }
	li.group { padding: 10px 2px 2px; border-top: 0; }
	li.group + li { border-top: 0; }
	li.group h6 {
		margin: 0;
		font-size: var(--t11);
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: var(--muted);
	}
	a { text-decoration: none; flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	a:hover { text-decoration: underline; }
	.subtitle { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--t11); color: var(--muted); }
	/* A date, so body text with the figures lined up rather than monospace. */
	.when { font-size: var(--t11); font-variant-numeric: tabular-nums; color: var(--muted); flex: none; margin-left: auto; }
	/* `.hint` is shared, in app.css, but leaves the browser's own bottom
	   margin on the `<p>` in place; this is the last thing in the card, so
	   that margin is zeroed here instead. */
	.hint { margin-bottom: 0; }

	@media (max-width: 720px) {
		.subtitle { display: none; }
		a { max-width: none; }
	}
</style>
