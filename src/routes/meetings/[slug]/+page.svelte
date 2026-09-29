<script lang="ts">
	/**
	 * The meeting card: the primer, drawn the way the artifact draws it. A
	 * lead paragraph on paper, a sand aside for the one caution, then each
	 * `##` section as a small-caps label over a sheet.
	 *
	 * The primer is the user's own note. Claude may propose a first draft or a
	 * revision; either arrives as a diff and is written only on Accept.
	 */
	import { invalidateAll } from '$app/navigation';
	import Draft from '$lib/components/Draft.svelte';
	import { noteHref } from '$lib/shared/links';

	let { data } = $props();
</script>

<svelte:head><title>{data.workspace.name} · Meeting card · prosoche</title></svelte:head>

{#if data.primer}
	{#if data.primer.exists}
		<div class="primer" data-testid="primer">
			{#each data.primer.sections as section, s (s)}
				{#if section.heading}<p class="label">{section.heading}</p>{/if}
				{#each section.blocks as block, b (b)}
					<!-- eslint-disable svelte/no-at-html-tags -->
					{#if block.kind === 'callout'}
						<div class="callout prose">{@html block.html}</div>
					{:else}
						<div class="sheet prose" class:lead={section.heading === null && b === 0}>{@html block.html}</div>
					{/if}
				{/each}
			{/each}
		</div>

		<div class="foot">
			<Draft
				label="Suggest updates"
				title="Claude proposes a revised primer from the latest notes. Nothing changes until you accept it."
				request={{ feature: 'primer-draft', slug: data.workspace.slug }}
				ondone={() => invalidateAll()}
			/>
			<a class="muted small" href={noteHref(data.primer.path)}>{data.primer.path}</a>
		</div>
	{:else}
		<div class="sheet empty-card" data-testid="primer-empty">
			<p><b>No primer yet.</b> A primer is the one page you read before walking in: what your job in the room is, the
				facts worth knowing, and the questions worth asking.</p>
			<p class="muted small">Write <code>{data.primer.path}</code> in Obsidian, or let Claude draft one from this
				workspace's log, meetings and notes. You see the whole draft before anything is written.</p>
			<Draft
				label="Draft a primer with Claude"
				title="Claude proposes a Primer.md. Nothing is written until you accept it."
				request={{ feature: 'primer-draft', slug: data.workspace.slug }}
				ondone={() => invalidateAll()}
			/>
		</div>
	{/if}
{/if}

<style>
	.primer > .sheet + .sheet, .primer > .callout + .sheet, .primer > .sheet + .callout, .primer > .callout + .callout { margin-top: var(--s3); }
	.primer .sheet { padding: var(--s4) var(--s5); }
	.primer .lead { font-size: var(--t16); }
	.primer :global(.prose > :first-child) { margin-top: 0; }
	.primer :global(.prose > :last-child) { margin-bottom: 0; }
	.primer .callout { font-size: var(--t14); line-height: 1.55; }
	.primer .callout :global(strong:first-child) { color: var(--sand-edge); }
	.primer .callout :global(p) { margin: 0; }

	/* A list is a set of rows: the item on one line, a nested list as the
	   muted note under it, divided by hairlines as the artifact does. */
	.primer .sheet :global(ul) { list-style: none; padding: 0; margin: var(--s3) 0 0; }
	.primer .sheet :global(ul > li) { padding: var(--s3) 0; margin: 0; border-top: 1px solid var(--line); }
	.primer .sheet :global(ul > li:first-child) { border-top: 0; padding-top: 0; }
	.primer .sheet :global(ul > li:last-child) { padding-bottom: 0; }
	.primer .sheet :global(li ul) { margin: 4px 0 0; }
	.primer .sheet :global(li ul > li) { border: 0; padding: 0; font-size: var(--t13); color: var(--muted); line-height: 1.5; }

	/* A numbered list is a set of frames: a teal rule, a bold title. */
	.primer .sheet :global(ol) { list-style: none; padding: 0; margin: 0; counter-reset: frame; }
	.primer .sheet :global(ol > li) { border-left: 3px solid var(--accent); padding: 2px 0 2px var(--s3); margin: 0 0 var(--s4); font-size: var(--t14); color: var(--muted); }
	.primer .sheet :global(ol > li:last-child) { margin-bottom: 0; }
	.primer .sheet :global(ol > li) { counter-increment: frame; }
	.primer .sheet :global(ol > li strong) { color: var(--text); }
	.primer .sheet :global(ol > li > strong:first-child),
	.primer .sheet :global(ol > li > p:first-child > strong:first-child) { display: block; margin-bottom: 2px; }
	.primer .sheet :global(ol > li > strong:first-child::before),
	.primer .sheet :global(ol > li > p:first-child > strong:first-child::before) { content: counter(frame) '. '; }

	.foot { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; margin-top: var(--s5); }
	.foot a { margin-left: auto; font-family: var(--mono); font-size: var(--t12); }
	.empty-card p { margin: 0 0 var(--s3); }
	.empty-card code { font: var(--t13) var(--mono); }
</style>
