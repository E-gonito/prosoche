<script lang="ts">
	/**
	 * Captures that have not been filed.
	 *
	 * Two lists, because capture writes two shapes: the lines of the quick
	 * capture note, and anything dropped into `Inbox/` as its own note. The
	 * lines get a File button; the notes do not, because moving a whole note
	 * is a rename and that belongs in the file tree, not behind a model.
	 */
	import Unavailable from './Unavailable.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Draft from '$lib/components/Draft.svelte';
	import type { LoadedWidget } from '$lib/shared/widgets';

	/** Produced by `src/lib/server/widgets/inbox.ts`. */
	interface InboxData {
		notes: Array<{ path: string; title: string; mtimeMs: number; preview: string }>;
		lines: Array<{ line: number; raw: string; text: string; day: string }>;
		folder: string;
		capturePath: string;
		total: number;
	}

	let { widget, refresh }: { widget: LoadedWidget; refresh?: () => void } = $props();
	const data = $derived(
		(widget.data as InboxData | null) ?? { notes: [], lines: [], folder: 'Inbox', capturePath: '', total: 0 }
	);
	const href = (path: string) => `/notes/${path.split('/').map(encodeURIComponent).join('/')}`;
	const empty = $derived(data.notes.length === 0 && data.lines.length === 0);
</script>

{#if widget.problem || !widget.data}
	<Unavailable {widget} />
{:else if empty}
	<EmptyState icon="check" title="Nothing waiting in {data.folder}/." />
{:else}
	<ul data-testid="inbox-widget">
		{#each data.lines as line (line.line)}
			<li class="line">
				<span class="text">{line.text}</span>
				{#if line.day}<span class="when">{line.day}</span>{/if}
				<Draft
					compact
					label="File"
					title="Propose a note to file this into"
					request={{ feature: 'capture', path: data.capturePath, line: line.line, expectedRaw: line.raw }}
					ondone={() => refresh?.()}
				/>
			</li>
		{/each}
		{#each data.notes as note (note.path)}
			<li>
				<a href={href(note.path)}>{note.title}</a>
				{#if note.preview}<span class="preview">{note.preview}</span>{/if}
			</li>
		{/each}
	</ul>
	{#if data.total > data.notes.length}
		<p class="hint">{data.notes.length} of {data.total} notes in {data.folder}/.</p>
	{/if}
{/if}

<style>
	ul { list-style: none; margin: 0; padding: 0; }
	li { padding: 6px 2px; border-top: 1px solid var(--line); min-width: 0; }
	li:first-child { border-top: 0; }
	.line { display: flex; align-items: flex-start; gap: var(--s2); flex-wrap: wrap; }
	.line .text { flex: 1; min-width: 0; font-size: var(--t13); }
	/* A date, so body text with the figures lined up rather than monospace. */
	.when { font-size: var(--t11); font-variant-numeric: tabular-nums; color: var(--muted); }
	a { text-decoration: none; }
	a:hover { text-decoration: underline; }
	.preview { display: block; font-size: var(--t12); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	/* `.hint` is shared, in app.css, but leaves the browser's own bottom
	   margin on the `<p>` in place; this is the last thing in the card, so
	   that margin is zeroed here instead. */
	.hint { margin-bottom: 0; }
</style>
