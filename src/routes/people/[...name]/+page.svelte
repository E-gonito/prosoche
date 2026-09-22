<script lang="ts">
	/**
	 * A person: their note, what you owe them, what you have said, and every note
	 * that mentions them.
	 *
	 * The log box is first because it is the thing you came here to do. Someone
	 * with no note reads exactly the same, minus the note.
	 */
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import TaskRow from '$lib/components/TaskRow.svelte';
	import { logContact } from '$lib/client/api';
	import type { Task } from '$lib/shared/task';

	let { data } = $props();

	let text = $state('');
	let problem = $state('');
	let busy = $state(false);
	let patched = $state<Record<string, Task>>({});

	const followUps = $derived(data.followUps.map((t) => patched[`${t.path}:${t.line}`] ?? t));
	const href = (path: string) => `/notes/${path.split('/').map(encodeURIComponent).join('/')}`;

	// Keep whatever they typed if the server refused it; clear the box only
	// once the line is actually in their note.
	async function log() {
		if (busy) return;
		busy = true;
		problem = '';
		const result = await logContact(data.name, text);
		busy = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		text = '';
		await invalidateAll();
	}
</script>

<svelte:head><title>{data.name} · prosoche</title></svelte:head>

<PageHeader title={data.name} testid="person-name">
	{#snippet meta()}
		{#if data.role || data.org}
			<span>{[data.role, data.org].filter(Boolean).join(' · ')}</span>
		{/if}
		<span>
			{#if data.lastContact}
				Last contact <b>{data.lastContact}</b>
			{:else}
				No contact logged yet
			{/if}
			· {data.mentions} note{data.mentions === 1 ? '' : 's'} mention{data.mentions === 1 ? 's' : ''} them
			{#if data.exists}· <a href={href(data.path)}>open their note</a>{/if}
		</span>
	{/snippet}
</PageHeader>

<div class="layout">
	<div class="column">
		<section class="card">
			<h3>Log a contact</h3>
			<form class="log-form" onsubmit={(e) => { e.preventDefault(); void log(); }}>
				<input
					bind:value={text}
					placeholder="What did you talk about?"
					aria-label="What you talked about with {data.name}"
					data-testid="log-text"
				/>
				<button class="btn primary" type="submit" disabled={busy} data-testid="log-submit">
					{busy ? 'Adding…' : 'Add'}
				</button>
			</form>
			{#if problem}
				<p class="problem" data-testid="log-problem">{problem}</p>
			{/if}
			{#if !data.exists}
				<p class="hint">No note yet for {data.name}; logging a contact creates one at <code>{data.path}</code>.</p>
			{/if}

			{#if data.log.length}
				<ul class="log" data-testid="person-log">
					{#each data.log as line (line.line)}
						<li><span class="day">{line.day ?? ''}</span><span>{line.text}</span></li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="card">
			<h3>Follow-ups <span class="right">{followUps.length} open</span></h3>
			{#each followUps as task (`${task.path}:${task.line}`)}
				<TaskRow
					{task}
					showPath
					onchange={(next) => (patched = { ...patched, [`${next.path}:${next.line}`]: next })}
				/>
			{:else}
				<p class="hint">Nothing open; a task mentioning <code>[[{data.name}]]</code> shows up here.</p>
			{/each}
		</section>
	</div>

	<div class="column">
		<section class="card">
			<h3>Mentioned in <span class="right">{data.mentionedIn.length}</span></h3>
			{#each data.mentionedIn as note (note.path)}
				<a class="row" href={href(note.path)} data-testid="person-backlink">{note.title}</a>
			{:else}
				<p class="hint">No notes link to <code>[[{data.name}]]</code> yet.</p>
			{/each}
		</section>

		{#if data.exists && data.html}
			<section class="card">
				<h3>Their note</h3>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				<div class="prose">{@html data.html}</div>
			</section>
		{/if}
	</div>
</div>

<style>
	.layout { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 14px; align-items: start; }
	.column { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

	.log-form { display: flex; gap: var(--s2); }
	.log-form input {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: var(--t13);
		padding: 7px 10px;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--field);
	}
	.log { list-style: none; margin: var(--s3) 0 0; padding: 0; font-size: var(--t13); }
	.log li { display: flex; gap: 10px; padding: var(--s1) 0; border-top: 1px solid var(--line); }
	/* A date, so body text with the figures lined up rather than monospace. */
	.log .day { flex: none; font-size: var(--t11); font-variant-numeric: tabular-nums; color: var(--muted); padding-top: 2px; width: 78px; }
	.row { display: block; padding: var(--s1) 0; color: var(--accent); text-decoration: none; }
	.row:hover { text-decoration: underline; }
	.problem { margin: var(--s2) 0 0; font-size: var(--t12); color: var(--bad); }
	.hint code { font: var(--t11) var(--mono); background: var(--soft); border-radius: 4px; padding: 1px var(--s1); }

	@media (max-width: 860px) {
		.layout { grid-template-columns: 1fr; }
	}
</style>
