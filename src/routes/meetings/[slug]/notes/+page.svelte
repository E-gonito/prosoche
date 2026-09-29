<script lang="ts">
	/**
	 * The notebook's Notes tab, as in the artifact: what is still open from
	 * earlier meetings, the meeting under way with its capture box, and the
	 * meetings before it.
	 *
	 * Every write is a click and goes straight to markdown: ticking an action
	 * rewrites that task line, a capture appends one line under
	 * `## Captured`, End meeting writes one `ended:` line. Only Prep asks
	 * Claude, and that arrives as a proposal to accept.
	 */
	import { invalidateAll } from '$app/navigation';
	import Draft from '$lib/components/Draft.svelte';
	import { editTask } from '$lib/client/api';
	import { meetingAction } from '$lib/client/meetings';
	import { noteHref } from '$lib/shared/links';
	import { formatMinutes } from '$lib/shared/time';
	import { CAPTURE_KINDS, CAPTURE_LABELS, type CaptureKind, type CapturedItem, type OpenAction } from '$lib/shared/meetings';

	let { data } = $props();

	let problem = $state('');
	let busy = $state(false);
	// The field starts from the event this page was opened for, and is the
	// user's once they type in it.
	let title = $state('');
	let edited = $state(false);
	let kind = $state<CaptureKind>('term');
	let text = $state('');
	let textInput: HTMLInputElement | undefined = $state();

	$effect(() => {
		if (!edited) title = data.prefill?.title ?? '';
	});

	const slug = $derived(data.workspace.slug);

	async function run(action: Parameters<typeof meetingAction>[0]): Promise<boolean> {
		busy = true;
		problem = '';
		const result = await meetingAction(action);
		busy = false;
		if (!result.ok) {
			problem = result.message;
			return false;
		}
		await invalidateAll();
		return true;
	}

	async function start(type: 'meeting' | 'standup') {
		const fromEvent = data.prefill && title.trim() === data.prefill.title;
		const ok = await run({
			action: 'start',
			slug,
			type,
			title: type === 'standup' && !title.trim() ? 'Standup' : title.trim() || 'Meeting',
			event: fromEvent ? data.prefill!.id : null,
			attendees: fromEvent ? data.prefill!.attendees : []
		});
		if (ok) {
			edited = false;
			textInput?.focus();
		}
	}

	async function capture(event: Event) {
		event.preventDefault();
		if (!data.current || !text.trim() || busy) return;
		const ok = await run({ action: 'capture', slug, path: data.current.path, kind, text });
		if (ok) {
			text = '';
			textInput?.focus();
		}
	}

	async function end() {
		if (data.current) await run({ action: 'end', slug, path: data.current.path });
	}

	async function tick(action: OpenAction) {
		busy = true;
		problem = '';
		const result = await editTask(action.task, { status: 'done' });
		busy = false;
		if (!result.ok) problem = result.message;
		await invalidateAll();
	}

	function grouped(items: CapturedItem[]): Array<[CaptureKind, CapturedItem[]]> {
		return CAPTURE_KINDS.map((k) => [k, items.filter((i) => i.kind === k)] as [CaptureKind, CapturedItem[]]).filter(([, list]) => list.length);
	}

	const typeLabel = (t: string) => (t === 'standup' ? 'Standup' : 'Meeting');
	const placeholder: Record<CaptureKind, string> = {
		term: 'A word you did not know…',
		question: 'Something to ask…',
		decision: 'What was decided…',
		action: 'Something to do…',
		note: 'Anything else…'
	};
</script>

<svelte:head><title>{data.workspace.name} · Notes · prosoche</title></svelte:head>

<details class="sheet before" open>
	<summary>Before you go in</summary>
	<p class="label">Open actions ({data.actions.length})</p>
	{#each data.actions as action (`${action.task.path}:${action.task.line}`)}
		<label class="action" data-testid="open-action">
			<input type="checkbox" disabled={busy} onchange={() => tick(action)} aria-label="Done: {action.text}" />
			<span>
				{action.text}
				<small class="muted">from <a href={noteHref(action.source.path)}>{action.source.title}{action.source.date ? ` ${action.source.date}` : ''}</a></small>
			</span>
		</label>
	{:else}
		<p class="none">Nothing open from earlier meetings.</p>
	{/each}
</details>

<p class="label">Current meeting</p>
<div class="sheet" data-testid="current-meeting">
	{#if data.current}
		{@const current = data.current}
		<div class="head">
			<div>
				<b class="name">{current.title}</b>
				<span class="muted small">{typeLabel(current.type)}{current.date ? ` · ${current.date}` : ''}{current.attendees.length ? ` · ${current.attendees.join(', ')}` : ''}</span>
			</div>
			<button class="btn" disabled={busy} onclick={end} data-testid="end-meeting">End meeting</button>
		</div>

		{#if current.talkingPoints.length}
			<p class="label">Talking points</p>
			<ul class="points">{#each current.talkingPoints as point, i (i)}<li>{point}</li>{/each}</ul>
		{/if}

		<form class="capture" onsubmit={capture}>
			<div class="kinds chips" role="radiogroup" aria-label="What to capture">
				{#each CAPTURE_KINDS as k (k)}
					<button
						type="button"
						class="chip"
						class:on={kind === k}
						role="radio"
						aria-checked={kind === k}
						onclick={() => (kind = k)}
						data-testid="capture-kind-{k}">{CAPTURE_LABELS[k].one}</button
					>
				{/each}
			</div>
			<div class="inputs">
				<input class="field" bind:this={textInput} bind:value={text} placeholder={placeholder[kind]} aria-label="Capture" data-testid="capture-text" />
				<button class="btn primary" disabled={busy || !text.trim()} data-testid="capture-add">Add</button>
			</div>
		</form>

		{#if current.captured.length}
			<div class="rows captured">
				{#each current.captured as item (item.line)}
					<div class="item"><span class="badge muted">{CAPTURE_LABELS[item.kind].one}</span> {item.text}</div>
				{/each}
			</div>
		{:else}
			<p class="none">Nothing captured yet. Terms, questions and decisions go here as they come up.</p>
		{/if}

		<div class="prep">
			<Draft
				label="Prep with Claude"
				title="Claude drafts talking points from the primer, recent meetings and open actions. Nothing is written until you accept."
				request={{ feature: 'meeting-prep', slug, event: current.event ?? undefined }}
				ondone={() => invalidateAll()}
			/>
			<a class="muted small" href={noteHref(current.path)}>Open the note</a>
		</div>
	{:else}
		<p class="intro">No meeting running. Start one when you walk in, then capture terms, questions and decisions as they come up.</p>
		{#if data.prefill}
			<p class="muted small" data-testid="prefill">
				From your calendar: {data.prefill.title}{data.prefill.startMin !== null ? ` at ${formatMinutes(data.prefill.startMin)}` : ''}{data.prefill.day !== data.today ? ` on ${data.prefill.day}` : ''}{data.prefill.attendees.length ? `, with ${data.prefill.attendees.join(', ')}` : ''}.
			</p>
		{/if}
		<input
			class="field title-field"
			bind:value={title}
			oninput={() => (edited = true)}
			placeholder="Meeting title"
			aria-label="Meeting title"
			data-testid="meeting-title"
		/>
		<div class="starts">
			<button class="btn primary" disabled={busy} onclick={() => start('standup')} data-testid="start-standup">Start standup</button>
			<button class="btn" disabled={busy} onclick={() => start('meeting')} data-testid="start-meeting">Start meeting</button>
		</div>
		<div class="prep">
			<Draft
				label="Prep with Claude"
				title="Claude drafts talking points and proposes the meeting note with them. Nothing is written until you accept."
				request={{ feature: 'meeting-prep', slug, title: title.trim() || undefined, event: data.prefill && title.trim() === data.prefill.title ? data.prefill.id : undefined }}
				ondone={() => invalidateAll()}
			/>
			<span class="muted small">Talking points from the primer, recent meetings and open actions.</span>
		</div>
	{/if}
	{#if problem}<p class="problem">{problem}</p>{/if}
</div>

<p class="label">Past meetings</p>
{#each data.past as meeting (meeting.path)}
	<details class="sheet past" data-testid="past-meeting">
		<summary>
			<b>{meeting.title}</b>
			<span class="muted small">· {typeLabel(meeting.type)}{meeting.date ? ` · ${meeting.date}` : ''} · {meeting.captured.length} item{meeting.captured.length === 1 ? '' : 's'}</span>
		</summary>
		{#each grouped(meeting.captured) as [k, items] (k)}
			<p class="label">{CAPTURE_LABELS[k].many}</p>
			<ul class="items">
				{#each items as item (item.line)}
					<li class:done={item.done}>{item.text}</li>
				{/each}
			</ul>
		{:else}
			<p class="none">Nothing was captured.</p>
		{/each}
		<a class="small" href={noteHref(meeting.path)}>Open the note</a>
	</details>
{:else}
	<p class="none">No past meetings yet.</p>
{/each}

<style>
	details > summary { cursor: pointer; font-weight: 600; list-style-position: inside; }
	.before .label { margin-top: var(--s3); }
	.action { display: flex; gap: 10px; align-items: flex-start; padding: var(--s2) 0; cursor: pointer; }
	.action input { margin-top: 5px; flex: none; }
	.action small { display: block; font-size: var(--t12); }

	.head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s3); flex-wrap: wrap; }
	.head .name { display: block; font-family: var(--serif); font-size: var(--t20); }
	.points { margin: 0; padding-left: 20px; font-size: var(--t14); }
	.capture { margin: var(--s4) 0 var(--s3); display: flex; flex-direction: column; gap: var(--s2); }
	.inputs { display: flex; gap: var(--s2); }
	.inputs .field { flex: 2; min-width: 0; }
	.inputs .btn { flex: none; }
	.captured { font-size: var(--t14); margin-top: var(--s3); }
	.item .badge { margin-right: 6px; }
	.prep { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; margin-top: var(--s4); padding-top: var(--s3); border-top: 1px solid var(--line); }
	.prep a { margin-left: auto; }
	.prep :global(.draft) { flex: 0 1 auto; max-width: 100%; }
	.prep :global(.draft:has(.proposal)) { flex-basis: 100%; }

	.intro { margin: 0 0 var(--s3); }
	.title-field { margin: var(--s2) 0 var(--s3); }
	.starts { display: flex; gap: var(--s2); flex-wrap: wrap; align-items: flex-start; }

	.past { padding: var(--s3) var(--s5); }
	.past + .past { margin-top: var(--s2); }
	.past summary { font-weight: 400; }
	.past .label { margin: var(--s3) 0 var(--s1); }
	.items { margin: 0; padding-left: 20px; font-size: var(--t14); }
	.items li.done { color: var(--muted); text-decoration: line-through; }
	.past > a { display: inline-block; margin-top: var(--s3); }

	@media (max-width: 720px) {
		.inputs { flex-wrap: wrap; }
		.inputs .field { flex: 1 1 100%; }
		.inputs .btn { flex: 1; justify-content: center; min-height: 44px; }
		.past { padding: var(--s3) var(--s4); }
	}
</style>
