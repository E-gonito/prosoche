<script lang="ts">
	/**
	 * A person: their note, what you owe them, what you have said, and every
	 * note that mentions them.
	 *
	 * The log box is first because it is the thing you came here to do. Someone
	 * with no note reads exactly the same, minus the note.
	 */
	import { invalidateAll } from '$app/navigation';
	import TaskRow from '$lib/components/TaskRow.svelte';
	import { api } from '$lib/client/api';
	import { noteHref } from '$lib/shared/links';
	import type { Task } from '$lib/shared/task';

	let { data } = $props();

	let text = $state('');
	let problem = $state('');
	let busy = $state(false);
	let patched = $state<Record<string, Task>>({});

	const followUps = $derived(data.followUps.map((t) => patched[`${t.path}:${t.line}`] ?? t));

	// Keep whatever they typed if the server refused it; clear the box only
	// once the line is actually in their note.
	async function log() {
		if (busy) return;
		busy = true;
		problem = '';
		const result = await api('/api/person', { name: data.name, text });
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

<div class="page wide">
	<div class="title">
		<h1>{data.name}</h1>
		<p>
			{#if data.role || data.org}{[data.role, data.org].filter(Boolean).join(' · ')} · {/if}
			{#if data.lastContact}Last contact <b>{data.lastContact}</b>{:else}No contact logged yet{/if}
			· {data.mentions} note{data.mentions === 1 ? '' : 's'} mention{data.mentions === 1 ? 's' : ''} them
			{#if data.exists}· <a href={noteHref(data.path)}>open their note</a>{/if}
		</p>
	</div>

	<div class="layout">
		<div class="column">
			<p class="label">Log a contact</p>
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
				<div class="sheet rows" data-testid="person-log">
					{#each data.log as line (line.line)}
						<div class="log-row"><span class="day">{line.day ?? ''}</span><span>{line.text}</span></div>
					{/each}
				</div>
			{/if}

			<p class="label">Follow-ups <span class="right">{followUps.length} open</span></p>
			<div class="sheet rows">
				{#each followUps as task (`${task.path}:${task.line}`)}
					<TaskRow
						{task}
						showPath
						onchange={(next) => (patched = { ...patched, [`${next.path}:${next.line}`]: next })}
					/>
				{:else}
					<p class="empty">Nothing open; a task mentioning <code>[[{data.name}]]</code> shows up here.</p>
				{/each}
			</div>
		</div>

		<div class="column">
			<p class="label">Mentioned in <span class="right">{data.mentionedIn.length}</span></p>
			<div class="sheet rows">
				{#each data.mentionedIn as note (note.path)}
					<a class="row" href={noteHref(note.path)} data-testid="person-backlink">{note.title}</a>
				{:else}
					<p class="empty">No notes link to <code>[[{data.name}]]</code> yet.</p>
				{/each}
			</div>

			{#if data.exists && data.html}
				<p class="label">Their note</p>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				<div class="prose">{@html data.html}</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.layout { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: var(--s5); align-items: start; margin-top: var(--s4); }
	.column { display: flex; flex-direction: column; gap: var(--s2); min-width: 0; }
	.column .label:not(:first-child) { margin-top: var(--s3); }

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
	.log-row { display: flex; gap: 10px; padding: var(--s2); border-top: 1px solid var(--line); font-size: var(--t13); }
	.log-row:first-child { border-top: 0; }
	.day { flex: none; font-size: var(--t11); font-variant-numeric: tabular-nums; color: var(--muted); padding-top: 2px; width: 78px; }
	.row { display: block; padding: var(--s2); color: var(--accent); border-top: 1px solid var(--line); }
	.row:first-child { border-top: 0; }
	.hint code { font: var(--t11) var(--mono); background: var(--soft); border-radius: 4px; padding: 1px var(--s1); }

	/* This page's own two columns, narrower than the usual 1100px cutoff: the
	   1.2fr log column still has an input and a row of task text in it, and
	   both get uncomfortably tight before 860px; see docs/design.md. */
	@media (max-width: 860px) {
		.layout { grid-template-columns: 1fr; }
	}
</style>
