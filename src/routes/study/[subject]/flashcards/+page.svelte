<script lang="ts">
	/**
	 * A subject's flashcards: the card files found in its folders, grouped by
	 * goal, each with a picker that sets its `goal:`, and a review for all of
	 * them or for one goal.
	 */
	import { invalidateAll } from '$app/navigation';
	import StudyTabs from '$lib/components/StudyTabs.svelte';
	import { setCardFileGoal } from '$lib/client/study';
	import { noteHref } from '$lib/shared/links';

	let { data } = $props();

	const base = $derived(`/study/${data.subject.slug}`);
	const goalNames = $derived(data.goals.map((g) => g.name));
	let saving = $state<string | null>(null);
	let problem = $state('');

	async function setGoal(path: string, goal: string) {
		saving = path;
		problem = '';
		const result = await setCardFileGoal(data.subject.slug, path, goal || null);
		saving = null;
		if (!result.ok) problem = result.message;
		await invalidateAll();
	}
</script>

<svelte:head><title>Flashcards · {data.subject.name} · prosoche</title></svelte:head>

<div class="page">
	<StudyTabs subject={data.subject} lede="Cards are written in your notes, in Spaced Repetition's syntax; a file's goal: puts its cards under a goal." />

	<div class="review-row">
		<p><b class="num" data-testid="cards-due">{data.due}</b> <span class="muted">due now, of {data.total} {data.total === 1 ? 'card' : 'cards'}</span></p>
		{#if data.due > 0}<a class="btn primary" href="{base}/review" data-testid="review-all">Review all</a>{/if}
		<a class="btn ghost small" href="{base}/import" data-testid="anki-import-link">Import Anki decks</a>
	</div>

	{#if problem}<p class="problem" role="status">{problem}</p>{/if}

	{#each data.groups as group (group.goal?.slug ?? '')}
		<p class="label">
			{group.goal ? group.goal.name : 'No goal'}
			<span class="right">
				{#if group.goal && group.due > 0}
					<a href="{base}/review?goal={group.goal.slug}" data-testid="review-goal">Review {group.due}</a>
				{:else}
					<span class="num muted">{group.due} due</span>
				{/if}
			</span>
		</p>
		<div class="sheet rows" data-testid="card-group" data-goal={group.goal?.name ?? ''}>
			{#each group.files as file (file.path)}
				<div class="file" data-testid="card-file">
					<div class="main">
						<a href={noteHref(file.path)}>{file.title}</a>
						<span class="muted small"><span class="path">{file.path}</span> · <span class="num">{file.cards} {file.cards === 1 ? 'card' : 'cards'}, {file.due} due</span></span>
					</div>
					<select
						class="field goal"
						aria-label="Goal for {file.title}"
						value={group.goal?.name ?? file.goal ?? ''}
						disabled={saving === file.path}
						data-testid="file-goal"
						onchange={(e) => setGoal(file.path, e.currentTarget.value)}
					>
						<option value="">No goal</option>
						{#each goalNames as name (name)}<option value={name}>{name}</option>{/each}
						{#if !group.goal && file.goal}
							<option value={file.goal}>{file.goal} (not in Goals)</option>
						{/if}
					</select>
				</div>
			{/each}
		</div>
	{:else}
		<p class="none">
			No card files here yet. A note in {data.subject.name}'s folders holds cards once it carries <code>#flashcards</code> and a
			<code>question::answer</code> line; "Make cards" on a note drafts some for you.
		</p>
	{/each}

	{#if data.invisible.length}
		<p class="label">Not seen by Obsidian</p>
		<p class="hint">These notes hold cards but no <code>#flashcards</code> tag, so neither Obsidian nor Study reviews them. Add the tag to include them.</p>
		<div class="sheet rows">
			{#each data.invisible as note (note.path)}
				<div class="file"><a href={noteHref(note.path)}>{note.title}</a><span class="num muted small">{note.cards} {note.cards === 1 ? 'card' : 'cards'}</span></div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.review-row { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); margin-bottom: var(--s2); }
	.review-row p { margin: 0; }
	.review-row b { font-size: var(--t20); }
	.file { display: flex; align-items: center; gap: var(--s3); justify-content: space-between; }
	.main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.path { font-family: var(--mono); font-size: var(--t12); overflow-wrap: anywhere; }
	.goal { flex: none; width: 200px; font-size: var(--t12); }
	.problem { color: var(--bad); margin-bottom: var(--s3); }

	@media (max-width: 720px) {
		.file { flex-wrap: wrap; }
		.goal { width: 100%; }
	}
</style>
