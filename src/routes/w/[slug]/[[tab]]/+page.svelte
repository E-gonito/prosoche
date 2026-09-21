<script lang="ts">
	/**
	 * A workspace tab: a colour, a name, a row of tabs, and the widgets the
	 * workspace file put on this one.
	 *
	 * The page renders and nothing else. Which widgets exist, what they contain
	 * and how they are arranged are all answered in the markdown, which is why
	 * the honest way to edit tabs is the "Edit definition" link rather than a
	 * form here that would rewrite someone's file behind their back.
	 */
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Widget from '$lib/components/widgets/Widget.svelte';

	let { data } = $props();

	const href = (slug: string, first: boolean) => (first ? `/w/${data.workspace.slug}` : `/w/${data.workspace.slug}/${slug}`);
</script>

<svelte:head><title>{data.workspace.name} · prosoche</title></svelte:head>

<PageHeader title={data.workspace.name} dot={data.workspace.color} testid="workspace-name">
	{#snippet meta()}
		<code class="tag">#{data.workspace.tag}</code>
	{/snippet}
	{#snippet actions()}
		<a class="btn" data-testid="edit-definition" href={data.definition}>Edit definition</a>
	{/snippet}
</PageHeader>

<nav class="tabs" data-testid="tabs" aria-label="{data.workspace.name} tabs">
	{#each data.tabs as tab, i (tab.slug)}
		<a
			href={href(tab.slug, i === 0)}
			class:active={data.tab === tab.slug}
			aria-current={data.tab === tab.slug ? 'page' : undefined}
			data-testid="tab"
		>{tab.title}</a>
	{/each}
</nav>

{#if data.widgets.length === 0}
	<p class="empty">
		This tab lists no widgets prosoche knows. Edit the workspace file to name some from the catalogue.
	</p>
{:else}
	<div class="grid">
		{#each data.widgets as widget (widget.name)}
			<Widget {widget} refresh={() => invalidateAll()} />
		{/each}
	</div>
{/if}

<p class="hint">
	Tabs and widgets live in the workspace's markdown file, not in a settings screen:
	<a href={data.definition}>{data.workspace.slug}.md</a> is the source of truth, and editing it here or in
	Obsidian is the same edit.
</p>

<style>
	.tag { font: 12px var(--mono); color: var(--muted); }

	.tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid var(--line); margin-bottom: 14px; }
	.tabs a {
		padding: 7px 12px;
		border-radius: 8px 8px 0 0;
		color: var(--muted);
		text-decoration: none;
		font-size: 13px;
		border: 1px solid transparent;
		border-bottom: 0;
		margin-bottom: -1px;
	}
	.tabs a:hover { background: var(--soft); color: var(--text); }
	.tabs a.active { background: var(--panel); border-color: var(--line); color: var(--text); font-weight: 600; }

	.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; align-items: start; }
	.hint { margin-top: 14px; font-size: 12px; color: var(--muted); }
	.empty { color: var(--muted); padding: 24px; text-align: center; }

	@media (max-width: 720px) {
		.grid { grid-template-columns: 1fr; }
	}
</style>
