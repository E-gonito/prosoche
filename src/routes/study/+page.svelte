<script lang="ts">
	/**
	 * The Study index: every subject as a card, everything due across them,
	 * and a form for a new subject.
	 */
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import { api } from '$lib/client/api';
	import { formatDuration } from '$lib/shared/duration';

	let { data } = $props();

	let name = $state('');
	let folders = $state('');
	let saving = $state(false);
	let problem = $state('');

	async function create(event: Event) {
		event.preventDefault();
		if (!name.trim() || saving) return;
		saving = true;
		problem = '';
		const extra = folders.split(',').map((f) => f.trim()).filter(Boolean);
		const result = await api<{ subject: { slug: string } }>('/api/study/subject', { name: name.trim(), folders: extra });
		saving = false;
		if (result.ok) await goto(`/study/${result.value.subject.slug}`, { invalidateAll: true });
		else problem = result.message;
	}
</script>

<svelte:head><title>Study · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Study</h1>
		<p>One subject per thing you are learning, each with its own goals, reading, sessions and cards.</p>
	</div>

	<div class="due sheet">
		<span class="count num" data-testid="due-count">{data.due}</span>
		<span class="muted">{data.due === 1 ? 'card' : 'cards'} due across every subject</span>
		{#if data.due > 0}<a class="btn primary" href="/study/review" data-testid="review-everything">Review everything due</a>{/if}
	</div>

	<p class="label">Subjects</p>
	{#if data.subjects.length === 0}
		<p class="empty">No subjects yet. Start one below.</p>
	{:else}
		<div class="subjects">
			{#each data.subjects as subject (subject.slug)}
				<div class="sheet subject" data-testid="subject-card">
					<h2><i class="dot" style="--dot: {subject.color}"></i><a class="stretch" href="/study/{subject.slug}">{subject.name}</a></h2>
					{#if subject.goals.length}
						<ul class="goals">
							{#each subject.goals.slice(0, 4) as goal (goal.name)}
								<li><span>{goal.name}</span><span class="num muted">{goal.done}/{goal.total}</span></li>
							{/each}
							{#if subject.goals.length > 4}<li class="muted">and {subject.goals.length - 4} more</li>{/if}
						</ul>
					{:else}
						<p class="muted small">No goals yet.</p>
					{/if}
					<p class="facts small">
						<span class="num">{formatDuration(subject.weekMinutes, ' ')} this week</span>
						<span class="num">{subject.due} due</span>
						{#if subject.streak > 0}<span class="num"><Icon name="flame" size={13} /> {subject.streak}</span>{/if}
					</p>
				</div>
			{/each}
		</div>
	{/if}

	<p class="label">New subject</p>
	<form class="row" onsubmit={create} data-testid="new-subject">
		<input class="field name" bind:value={name} placeholder="Filipino" aria-label="Subject name" data-testid="subject-name" />
		<input class="field folders" bind:value={folders} placeholder="Reference folders, comma separated (optional)" aria-label="Reference folders" data-testid="subject-folders" />
		<button class="btn primary" disabled={!name.trim() || saving} data-testid="create-subject">{saving ? 'Creating…' : 'Create'}</button>
	</form>
	<p class="hint">Files go in <code>Study/{name.trim() || '<name>'}</code>, cards in <code>Study/{name.trim() || '<name>'}/Flashcards/</code>.</p>
	{#if problem}<p class="problem" role="status">{problem}</p>{/if}
</div>

<style>
	.due { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
	/* The one figure on the page meant to be read at a glance. */
	.count { font-size: 34px; line-height: 1; font-weight: 600; }
	.due .btn { margin-left: auto; }

	.subjects { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--s4); }
	/* The whole card opens the subject, through its name's link stretched over
	   it. */
	.subject { position: relative; display: flex; flex-direction: column; gap: var(--s2); color: var(--text); }
	.subject:hover { border-color: var(--accent); }
	.stretch { color: inherit; }
	.stretch::after { content: ''; position: absolute; inset: 0; }
	.stretch:hover { text-decoration: none; }
	.subject h2 { margin: 0; display: flex; align-items: center; gap: var(--s2); font: 600 var(--t16) var(--serif); }
	.goals { list-style: none; margin: 0; padding: 0; font-size: var(--t13); display: flex; flex-direction: column; gap: 2px; }
	.goals li { display: flex; justify-content: space-between; gap: var(--s2); }
	.facts { display: flex; gap: var(--s3); flex-wrap: wrap; margin: 0; color: var(--muted); }
	.facts span { display: inline-flex; align-items: center; gap: 3px; }

	.row { display: flex; flex-wrap: wrap; gap: var(--s2); }
	.row .name { flex: 1; min-width: 160px; }
	.row .folders { flex: 2; min-width: 200px; }
	.hint { margin-top: var(--s2); }
</style>
