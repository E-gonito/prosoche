<script lang="ts">
	/**
	 * The week's meetings, and the notebooks they lead into.
	 *
	 * Each calendar event shows its workspace. An event whose title has never
	 * been assigned asks once, with a workspace named in the title offered
	 * first; the choice is remembered by title in `_hub/meetings.md`, so the
	 * next Dev Weekly already knows where it belongs. Without a calendar the
	 * page is just the notebooks, and a meeting is started from inside one.
	 */
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	import { meetingAction } from '$lib/client/meetings';
	import { formatMinutes } from '$lib/shared/time';
	import { relativeDay } from '$lib/shared/links';
	import type { EventRow } from '$lib/shared/meetings';

	let { data } = $props();

	let problem = $state('');
	let busy = $state<string | null>(null);
	let changing = $state<string | null>(null);

	const highlighted = $derived(page.url.searchParams.get('event'));
	const bySlug = $derived(new Map(data.workspaces.map((w) => [w.slug, w])));

	onMount(() => {
		if (!highlighted) return;
		const row = document.querySelector(`[data-event-id="${CSS.escape(highlighted)}"]`);
		row?.scrollIntoView({ block: 'center' });
	});

	function when(e: EventRow): string {
		if (e.startMin === null) return 'All day';
		return e.endMin !== null ? `${formatMinutes(e.startMin)}–${formatMinutes(e.endMin)}` : formatMinutes(e.startMin);
	}

	function dayLabel(day: string): string {
		const [y, m, d] = day.split('-').map(Number);
		const date = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
		const rel = relativeDay(day, data.today);
		return rel === 'today' || rel === 'tomorrow' ? `${rel[0].toUpperCase()}${rel.slice(1)} · ${date}` : date;
	}

	async function assign(e: EventRow, slug: string) {
		if (!slug) return;
		busy = e.id;
		problem = '';
		const result = await meetingAction({ action: 'assign', title: e.title, slug });
		busy = null;
		changing = null;
		if (!result.ok) problem = result.message;
		else await invalidateAll();
	}

	async function start(e: EventRow) {
		if (!e.workspace) return;
		busy = e.id;
		problem = '';
		const result = await meetingAction({
			action: 'start',
			slug: e.workspace,
			type: 'meeting',
			title: e.title,
			event: e.id,
			attendees: e.attendees
		});
		busy = null;
		if (!result.ok) problem = result.message;
		else await goto(`/meetings/${e.workspace}/notes`);
	}
</script>

<svelte:head><title>Meetings · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Meetings</h1>
		<p>Today and the next seven days. Read the card before you go in; capture what you don't know while you're there.</p>
	</div>

	{#if !data.calendar.ok}
		<p class="callout" data-testid="no-calendar">
			{#if data.calendar.reason === 'not-configured'}
				<b>No calendar yet.</b> Set <code>HUB_GCAL_ICS</code> to your Google Calendar's secret iCal address to see your
				meetings here. Until then, open a notebook below and start a meeting by hand.
			{:else}
				<b>Calendar unreachable.</b> {data.calendar.message} The notebooks below still work.
			{/if}
		</p>
	{:else if data.days.length === 0}
		<p class="none">Nothing on the calendar this week.</p>
	{/if}

	{#each data.days as day (day.day)}
		<p class="label">{dayLabel(day.day)}</p>
		<div class="sheet rows events">
			{#each day.events as e (e.id)}
				{@const ws = e.workspace ? bySlug.get(e.workspace) : null}
				{@const suggested = e.suggestion ? bySlug.get(e.suggestion) : null}
				<div class="event" class:hl={highlighted === e.id} data-event-id={e.id} data-testid="event">
					<span class="when num">{when(e)}</span>
					<div class="what">
						<b>{e.title}</b>
						{#if e.attendees.length}<span class="muted small">{e.attendees.join(', ')}</span>{/if}
						<div class="assign">
							{#if ws && changing !== e.id}
								<a class="ws" href="/meetings/{ws.slug}"><i style="--dot: {ws.color}"></i>{ws.name}</a>
								<button class="btn ghost small" onclick={() => (changing = e.id)}>Change</button>
							{:else}
								{#if suggested && !ws}
									<button class="chip" disabled={busy === e.id} onclick={() => assign(e, suggested.slug)} data-testid="suggestion">
										<i style="--dot: {suggested.color}"></i>{suggested.name}?
									</button>
								{/if}
								<select
									class="field pick"
									aria-label="Workspace for {e.title}"
									disabled={busy === e.id}
									onchange={(ev) => assign(e, ev.currentTarget.value)}
								>
									<option value="">{ws ? 'Move to…' : 'Pick a workspace…'}</option>
									{#each data.workspaces as w (w.slug)}<option value={w.slug}>{w.name}</option>{/each}
								</select>
								{#if changing === e.id}<button class="btn ghost small" onclick={() => (changing = null)}>Cancel</button>{/if}
							{/if}
						</div>
					</div>
					<div class="go">
						{#if e.link}<a class="icon-btn" href={e.link} target="_blank" rel="noreferrer" aria-label="Join call"><Icon name="video" /></a>{/if}
						{#if ws}
							<a class="btn small" href="/meetings/{ws.slug}/notes?event={encodeURIComponent(e.id)}">Prep</a>
							<button class="btn small primary" disabled={busy === e.id} onclick={() => start(e)}>Start</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/each}

	{#if problem}<p class="problem">{problem}</p>{/if}

	<p class="label">Notebooks</p>
	<div class="sheet rows" data-testid="notebooks">
		{#each data.notebooks as nb (nb.slug)}
			<a class="notebook" href="/meetings/{nb.slug}">
				<i style="--dot: {nb.color}"></i>
				<span class="name">{nb.name}</span>
				<span class="muted small">
					{nb.meetings ? `${nb.meetings} meeting${nb.meetings === 1 ? '' : 's'}` : 'No meetings yet'}{nb.last ? ` · last ${relativeDay(nb.last, data.today)}` : ''}{nb.primer ? '' : ' · no primer'}
				</span>
				<Icon name="chevron-right" />
			</a>
		{:else}
			<p class="none">No workspace has a folder yet, so there is nowhere to keep a notebook.</p>
		{/each}
	</div>
</div>

<style>
	.callout code { font: var(--t13) var(--mono); }
	.events { overflow: hidden; }
	.event { display: grid; grid-template-columns: 96px minmax(0, 1fr) auto; gap: var(--s3); align-items: start; }
	.event.hl { background: var(--accent-soft); margin: 0 calc(-1 * var(--s5)); padding-left: var(--s5); padding-right: var(--s5); }
	.when { color: var(--muted); font-size: var(--t14); padding-top: 1px; }
	.what { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.assign { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; margin-top: var(--s1); }
	.ws { display: inline-flex; align-items: center; gap: 6px; font-size: var(--t13); font-weight: 500; }
	.pick { width: auto; padding: 3px var(--s2); font-size: var(--t13); }
	.go { display: flex; align-items: center; gap: var(--s1); }
	i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--dot); display: inline-block; }
	.notebook { display: flex; align-items: center; gap: 10px; color: var(--text); }
	.notebook:hover { text-decoration: none; }
	.notebook:hover .name { color: var(--accent); }
	.notebook .name { font-weight: 500; }
	.notebook .muted { margin-left: auto; text-align: right; }
	.notebook :global(svg) { color: var(--muted); flex: none; }

	@media (max-width: 720px) {
		.event { grid-template-columns: 1fr; gap: var(--s1); }
		.event.hl { margin: 0 calc(-1 * var(--s4)); padding-left: var(--s4); padding-right: var(--s4); }
		.go { justify-content: flex-start; margin-top: var(--s1); }
		/* The smallest target a thumb reliably hits. */
		.go .btn, .go .icon-btn { min-height: 44px; min-width: 44px; padding: 0 var(--s4); font-size: var(--t14); justify-content: center; }
		.pick, .assign .chip { min-height: 36px; }
		.notebook .muted { display: none; }
		.notebook :global(svg) { margin-left: auto; }
	}
</style>
