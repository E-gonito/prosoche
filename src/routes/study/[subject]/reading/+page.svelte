<script lang="ts">
	/**
	 * A subject's reading list, shown as grouped lists: To read, Reading,
	 * Paused, Done, or whatever columns the file has.
	 *
	 * The list it is given is the server's reading of `Reading List.md`. Every
	 * change is one op sent with the hash of that reading, and the list that
	 * comes back replaces this one, whether the op was applied, refused or
	 * beaten by an edit made somewhere else, as the workspace board does. What
	 * an op does to the file is the server's business; this page only chooses
	 * which op to ask for.
	 */
	import { untrack } from 'svelte';
	import StudyTabs from '$lib/components/StudyTabs.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { api } from '$lib/client/api';
	import { READING_KINDS, type ReadingFields, type ReadingItem, type ReadingList, type ReadingOp } from '$lib/shared/study';

	let { data } = $props();

	let current = $state(untrack(() => data.study.reading));
	// A fresh load from the server wins over whatever this copy has become.
	$effect(() => {
		current = data.study.reading;
	});

	let busy = $state(false);
	let problem = $state('');
	let menu = $state<number | null>(null);
	let editing = $state<number | null>(null);
	let confirming = $state<number | null>(null);

	const blank = (): ReadingFields => ({ title: '', url: null, kind: 'book', goal: null });
	let draft = $state(blank());
	let draftGroup = $state(0);
	let edit = $state(blank());

	const count = $derived(current.groups.reduce((sum, g) => sum + g.items.length, 0));
	const goalNames = $derived(data.study.goalRefs.map((g) => g.name));

	async function run(op: ReadingOp): Promise<boolean> {
		if (busy) return false;
		busy = true;
		problem = '';
		menu = null;
		// Every answer but a lost connection carries the list as it now is.
		const result = await api<{ list: ReadingList }>('/api/study/reading', { subject: data.subject.slug, hash: current.hash, op });
		busy = false;
		if (result.ok) {
			current = result.value.list;
			return true;
		}
		if (result.body.list) current = result.body.list;
		problem = result.message;
		return false;
	}

	async function add(event: Event) {
		event.preventDefault();
		if (!draft.title.trim() && !draft.url?.trim()) return;
		if (await run({ kind: 'add', group: draftGroup, item: { ...draft, url: draft.url?.trim() || null } })) {
			draft = { ...blank(), kind: draft.kind, goal: draft.goal };
		}
	}

	function startEdit(item: ReadingItem) {
		menu = null;
		confirming = null;
		edit = { title: item.title, url: item.url, kind: item.kind, goal: item.goal };
		editing = item.line;
	}

	async function saveEdit(event: Event) {
		event.preventDefault();
		if (editing === null) return;
		if (await run({ kind: 'edit', line: editing, item: { ...edit, url: edit.url?.trim() || null } })) editing = null;
	}

	function move(item: ReadingItem, group: number, index: number) {
		void run({ kind: 'move', line: item.line, group, index });
	}

	async function remove(item: ReadingItem) {
		if (await run({ kind: 'delete', line: item.line })) confirming = null;
	}

	/** The goal picker's options: the subject's goals, and an item's own goal if it names one that is gone. */
	const goalOptions = (own: string | null) => (own && !goalNames.includes(own) ? [...goalNames, own] : goalNames);
</script>

<svelte:window
	onclick={(e) => {
		if (menu !== null && !(e.target as HTMLElement).closest('[data-menu]')) menu = null;
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape') menu = null;
	}}
/>

<svelte:head><title>Reading list · {data.subject.name} · prosoche</title></svelte:head>

{#snippet fields(f: ReadingFields, prefix: string)}
	<input class="field title-field" bind:value={f.title} placeholder="Title" aria-label="Title" data-testid="{prefix}-title" />
	<input class="field url" value={f.url ?? ''} oninput={(e) => (f.url = e.currentTarget.value || null)} placeholder="Link (optional)" aria-label="Link" data-testid="{prefix}-url" />
	<select class="field kind" bind:value={f.kind} aria-label="Kind" data-testid="{prefix}-kind">
		{#each READING_KINDS as kind (kind)}<option value={kind}>{kind}</option>{/each}
	</select>
	<select class="field goal" value={f.goal ?? ''} onchange={(e) => (f.goal = e.currentTarget.value || null)} aria-label="Goal" data-testid="{prefix}-goal">
		<option value="">No goal</option>
		{#each goalOptions(f.goal) as name (name)}<option value={name}>{name}</option>{/each}
	</select>
{/snippet}

<div class="page">
	<StudyTabs subject={data.subject} lede="What to read or watch next, what is under way, and what is done." />

	<p class="label">Add to the list</p>
	<form class="form" onsubmit={add} data-testid="reading-add">
		{@render fields(draft, 'add')}
		<select class="field group" bind:value={draftGroup} aria-label="Status" data-testid="add-group">
			{#each current.groups as group, g (g)}<option value={g}>{group.title}</option>{/each}
		</select>
		<button class="btn primary" disabled={busy || (!draft.title.trim() && !draft.url?.trim())} data-testid="add-item">Add</button>
	</form>

	{#if problem}<p class="problem" role="status" data-testid="reading-problem">{problem}</p>{/if}
	{#if count === 0}<p class="empty">Nothing on the list yet. Add the first thing above.</p>{/if}

	{#each current.groups as group, g (g)}
		{#if group.items.length > 0}
			<p class="label">{group.title}<span class="right num">{group.items.length}</span></p>
			<div class="sheet rows" data-testid="reading-group" data-group={group.title}>
				{#each group.items as item, i (item.line)}
					{#if editing === item.line}
						<form class="form edit" onsubmit={saveEdit} data-testid="reading-edit">
							{@render fields(edit, 'edit')}
							<span class="actions">
								<button class="btn primary small" disabled={busy} data-testid="edit-save">Save</button>
								<button type="button" class="btn ghost small" onclick={() => (editing = null)}>Cancel</button>
							</span>
						</form>
					{:else}
						<div class="item" class:done={item.done} data-testid="reading-item">
							<div class="main">
								{#if item.url}
									<a class="item-title" href={item.url} target="_blank" rel="noreferrer">{item.title} <Icon name="external-link" size={12} /></a>
								{:else}
									<span class="item-title">{item.title}</span>
								{/if}
								<span class="meta small">
									{#if item.kind !== 'other'}<span class="badge muted">{item.kind}</span>{/if}
									{#if item.goal}<span class="chip quiet">{item.goal}</span>{/if}
								</span>
							</div>
							{#if confirming === item.line}
								<span class="confirm small">
									Delete it?
									<button class="btn ghost small remove" disabled={busy} onclick={() => remove(item)} data-testid="delete-confirm">Delete</button>
									<button class="btn ghost small" onclick={() => (confirming = null)}>Keep</button>
								</span>
							{:else}
								<select
									class="field status"
									aria-label="Status of {item.title}"
									value={g}
									disabled={busy}
									data-testid="item-status"
									onchange={(e) => move(item, Number(e.currentTarget.value), current.groups[Number(e.currentTarget.value)].items.length)}
								>
									{#each current.groups as other, t (t)}<option value={t}>{other.title}</option>{/each}
								</select>
								<span class="menu-wrap" data-menu>
									<button
										class="icon-btn"
										aria-label="Options for {item.title}"
										aria-haspopup="menu"
										aria-expanded={menu === item.line}
										data-testid="item-menu"
										onclick={() => (menu = menu === item.line ? null : item.line)}
									><Icon name="more-horizontal" size={16} /></button>
									{#if menu === item.line}
										<div class="menu" role="menu">
											<button role="menuitem" onclick={() => startEdit(item)} data-testid="item-edit">Edit</button>
											{#if i > 0}<button role="menuitem" onclick={() => move(item, g, i - 1)} data-testid="item-up">Move up</button>{/if}
											{#if i < group.items.length - 1}<button role="menuitem" onclick={() => move(item, g, i + 1)} data-testid="item-down">Move down</button>{/if}
											<button role="menuitem" class="remove" onclick={() => { menu = null; confirming = item.line; }} data-testid="item-delete">Delete</button>
										</div>
									{/if}
								</span>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	{/each}
</div>

<style>
	.form { display: flex; flex-wrap: wrap; gap: var(--s2); margin-bottom: var(--s4); }
	.form .title-field { flex: 2; min-width: 180px; }
	.form .url { flex: 2; min-width: 160px; }
	.form .kind, .form .group { flex: none; width: 110px; }
	.form .goal { flex: 1; min-width: 140px; }
	.form.edit { margin: 0; }
	.actions { display: flex; gap: var(--s1); }

	.item { display: flex; align-items: center; gap: var(--s3); }
	.main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.item-title { color: var(--text); font-weight: 500; overflow-wrap: anywhere; }
	a.item-title:hover { color: var(--accent); text-decoration: none; }
	.item-title :global(svg) { color: var(--muted); vertical-align: -1px; }
	.item.done .item-title { color: var(--muted); }
	.meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
	.meta:empty { display: none; }
	.status { flex: none; width: 110px; font-size: var(--t12); }

	.menu-wrap { position: relative; }
	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + 4px);
		z-index: 10;
		min-width: 140px;
		display: flex;
		flex-direction: column;
		padding: var(--s1);
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		box-shadow: var(--shadow-lg);
	}
	.menu button { text-align: left; padding: 6px var(--s2); border: 0; background: none; border-radius: var(--r-sm); font: inherit; font-size: var(--t13); color: var(--text); cursor: pointer; }
	.menu button:hover { background: var(--soft); }
	.confirm { display: flex; align-items: center; gap: var(--s1); }
	/* `.remove`, not `.danger`, which is the global filled red button. */
	.menu button.remove { color: var(--bad); }

	.problem { margin-bottom: var(--s3); }

	@media (max-width: 720px) {
		.form .title-field, .form .url, .form .goal { flex-basis: 100%; }
		.form .kind, .form .group { flex: 1; width: auto; }
		.item { flex-wrap: wrap; }
		.status { margin-left: auto; }
	}
</style>
