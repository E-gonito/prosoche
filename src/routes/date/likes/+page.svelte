<script lang="ts">
	/**
	 * Likes: log one, settle the pending ones, and keep every record right.
	 *
	 * Pending comes first, oldest first, each with how long it has waited and
	 * a Yes and a No a thumb can reach. Under it, every like, newest first,
	 * filtered by status (kept in the URL), each opening an editor. Then the
	 * type note and the JSON export and import. A pending like still unsettled
	 * `AUTO_RESOLVE_DAYS` after it was sent has already become no by the time
	 * this page loads.
	 */
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/client/api';
	import MasterNote from '$lib/components/MasterNote.svelte';
	import LikeEditor from '$lib/components/likes/LikeEditor.svelte';
	import LikeQuickAdd from '$lib/components/likes/LikeQuickAdd.svelte';
	import { AUTO_RESOLVE_DAYS, LIKE_STATUSES, OUTCOME, type Like, type LikeStatus } from '$lib/shared/likes';
	import { daysBetween } from '$lib/shared/time';

	let { data } = $props();

	const pending = $derived(data.likes.filter((l: Like) => l.status === 'pending'));
	const filter = $derived((LIKE_STATUSES as readonly string[]).includes(page.url.searchParams.get('status') ?? '') ? (page.url.searchParams.get('status') as LikeStatus) : null);
	const shown = $derived([...data.likes].reverse().filter((l: Like) => filter === null || l.status === filter));

	let open = $state<string | null>(null);
	let busy = $state<string | null>(null);
	let problem = $state('');
	let report = $state('');

	async function resolve(like: Like, status: 'yes' | 'no') {
		busy = like.id;
		problem = '';
		const result = await api('/api/dating/likes', { label: like.label, expectedHash: like.hash, status }, { method: 'PUT' });
		busy = null;
		if (!result.ok) problem = result.message;
		await invalidateAll();
	}

	function setFilter(status: LikeStatus | null) {
		const url = new URL(page.url);
		if (status) url.searchParams.set('status', status);
		else url.searchParams.delete('status');
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	async function importFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		report = '';
		let parsed: unknown;
		try {
			parsed = JSON.parse(await file.text());
		} catch {
			report = 'That file is not JSON.';
			return;
		}
		const result = await api<{ created: number; updated: number; unchanged: number; problems: string[] }>('/api/dating/likes/import', { data: parsed });
		if (!result.ok) {
			report = result.message;
			return;
		}
		const r = result.value;
		report = [`${r.created} added, ${r.updated} updated, ${r.unchanged} already the same.`, ...r.problems].join(' ');
		await invalidateAll();
	}

	const days = (like: Like) => daysBetween(like.sentDate, data.today);
	const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
</script>

<svelte:head><title>Likes · Date · prosoche</title></svelte:head>

<p class="label">Log a like</p>
<LikeQuickAdd today={data.today} typeHtml={data.type.html} />

<p class="label">Pending <span class="right muted small num">{pending.length}</span></p>
{#if pending.length === 0}
	<p class="empty">Nothing pending.</p>
{:else}
	<ul class="sheet list" data-testid="likes-pending">
		{#each pending as like (like.id)}
			<li class="pending" data-testid="like-pending">
				<div class="who">
					<b>{like.label}</b>
					<span class="muted small num">{like.forecast}% · {days(like) === 0 ? 'today' : `${plural(days(like), 'day')} pending`}</span>
				</div>
				<button class="btn yes" disabled={busy === like.id} onclick={() => resolve(like, 'yes')} data-testid="like-yes">Yes</button>
				<button class="btn no" disabled={busy === like.id} onclick={() => resolve(like, 'no')} data-testid="like-no">No</button>
			</li>
		{/each}
	</ul>
{/if}
{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
<p class="hint">Yes means {OUTCOME}. A like still pending {AUTO_RESOLVE_DAYS} days after you sent it becomes no on its own; you can still change it.</p>

<p class="label">All likes <span class="right muted small num">{data.likes.length}</span></p>
<div class="chips filter" role="group" aria-label="Filter by outcome" data-testid="likes-filter">
	<button class="chip" class:on={filter === null} onclick={() => setFilter(null)}>All</button>
	{#each LIKE_STATUSES as s (s)}
		<button class="chip" class:on={filter === s} onclick={() => setFilter(s)} data-value={s}>{s}</button>
	{/each}
</div>
{#if shown.length === 0}
	<p class="empty">No likes here.</p>
{:else}
	<ul class="sheet list" data-testid="likes-all">
		{#each shown as like (like.id)}
			<li data-testid="like-row" data-status={like.status}>
				<button class="row" onclick={() => (open = open === like.id ? null : like.id)} aria-expanded={open === like.id}>
					<b>{like.label}</b>
					<span class="muted small num">{like.sentDate} · {like.forecast}%{like.sentDateMigrated ? ' · day guessed' : ''}</span>
					<span class="status {like.status}">{like.status}{like.resolvedBy === 'auto' ? ' (auto)' : ''}</span>
				</button>
				{#if open === like.id}
					<LikeEditor {like} today={data.today} onclose={() => (open = null)} />
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<p class="label">My type</p>
<div class="sheet">
	<MasterNote
		{...data.type}
		saveTo="/api/dating/type"
		empty="No note yet: the non-negotiables and the nice-to-haves, to check “fits my type” against."
		action="Write it down"
	/>
</div>

<p class="label">Export and import</p>
<div class="sheet io">
	<a class="btn" href="/api/dating/likes" download data-testid="likes-export">Export JSON</a>
	<label class="btn">
		Import JSON
		<input type="file" accept="application/json,.json" onchange={importFile} hidden data-testid="likes-import" />
	</label>
	{#if report}<p class="hint" role="status" data-testid="likes-import-report">{report}</p>{/if}
</div>

<style>
	.list { list-style: none; margin: 0 0 var(--s2); padding: 0 var(--s3); }
	.list li { border-bottom: 1px solid var(--line); }
	.list li:last-child { border-bottom: 0; }
	.pending { display: flex; align-items: center; gap: var(--s2); padding: var(--s2) 0; }
	.who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.who b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.btn.yes, .btn.no { min-width: 56px; min-height: 44px; justify-content: center; }
	.btn.yes { border-color: var(--accent); color: var(--accent); }
	.row { display: grid; grid-template-columns: 1fr auto; gap: 2px var(--s3); width: 100%; padding: var(--s3) 0; background: none; border: 0; text-align: left; cursor: pointer; font: inherit; color: inherit; min-height: 44px; }
	.row .muted { grid-column: 1; }
	.row .status { grid-row: 1 / 3; grid-column: 2; align-self: center; font-size: var(--t13); }
	.status.yes { color: var(--accent); font-weight: 600; }
	.status.pending { color: var(--muted); }
	.filter { margin-bottom: var(--s2); }
	.filter .chip { min-height: 36px; text-transform: capitalize; }
	.io { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); }
	.io .hint { flex-basis: 100%; margin: 0; }
</style>
