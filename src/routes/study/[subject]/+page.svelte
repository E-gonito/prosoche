<script lang="ts">
	/**
	 * A subject at a glance: the cards to review now, this week's time and the
	 * streak, then each goal with its milestones, hours, reading and cards,
	 * and last the folders its notes and cards come from. A glossary whose
	 * terms become its cards is linked under the flashcards, to scan for more.
	 */
	import StudyTabs from '$lib/components/StudyTabs.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import FolderEditor from '$lib/components/FolderEditor.svelte';
	import { formatDuration } from '$lib/shared/duration';

	let { data } = $props();

	const base = $derived(`/study/${data.subject.slug}`);
	const weekTarget = $derived(data.study.weeklyHours ? data.study.weeklyHours * 60 : null);
	const weekPct = $derived(weekTarget ? Math.min(100, Math.round((data.study.weekMinutes / weekTarget) * 100)) : null);
	const loose = $derived(data.study.unassigned.weekMinutes > 0 || data.study.unassigned.reading.length > 0 || data.study.unassigned.due > 0);
</script>

<svelte:head><title>{data.subject.name} · Study · prosoche</title></svelte:head>

<div class="page">
	<StudyTabs subject={data.subject} lede="Goals, reading, sessions and cards, all read straight from the vault." />

	<div class="grid">
		<section class="sheet">
			<p class="label">Flashcards</p>
			<div class="due-row">
				<span class="count" data-testid="due-count">{data.study.due}</span>
				<span class="muted">due now{data.study.fresh || data.study.waiting ? ` · ${data.study.fresh} new today · ${data.study.waiting} waiting` : ''}</span>
				<span class="buttons">
					{#if data.study.due > 0}
						<a class="btn primary" href="{base}/review" data-testid="review-link">Review</a>
					{/if}
				</span>
			</div>
			{#if data.study.due === 0}<p class="empty">Nothing due right now.</p>{/if}
			{#each data.glossaries as g (g.slug)}
				<p class="hint" data-testid="subject-glossary">Terms in <a href="/glossary/{g.slug}#scan">{g.name}</a> become cards here; scan your notes there for more.</p>
			{/each}
		</section>

		<section class="sheet">
			<p class="label">
				This week
				<span class="right num" data-testid="week-time">
					{formatDuration(data.study.weekMinutes, ' ')}{weekTarget ? ` of ${formatDuration(weekTarget, ' ')}` : ''}
				</span>
			</p>
			{#if weekPct !== null}
				<div class="bar"><i style="width: {weekPct}%"></i></div>
			{/if}
			<p class="streak" data-testid="streak">
				<Icon name="flame" size={15} label="Streak" />
				<b class="num">{data.study.streak}</b> {data.study.streak === 1 ? 'day' : 'days'} in a row
			</p>
		</section>
	</div>

	<p class="label">Goals<span class="right"><a href="{base}/goals">Open</a></span></p>
	{#if data.study.progress.length === 0}
		<p class="empty">No goals yet. <a href="{base}/goals">Add the first one</a>: reading, sessions and cards all roll up by goal.</p>
	{:else}
		<div class="sheet rows" data-testid="goals-summary">
			{#each data.study.progress as goal (goal.slug)}
				<div class="goal" data-testid="goal">
					<div class="head">
						<span class="name">{goal.name}</span>
						<span class="muted small num">{goal.done} of {goal.total}</span>
					</div>
					<div class="bar small"><i style="width: {goal.total ? Math.round((goal.done / goal.total) * 100) : 0}%"></i></div>
					{#if goal.next}
						<p class="next muted small">Next: {goal.next.text}{goal.next.due ? ` · 📅 ${goal.next.due}` : ''}</p>
					{:else if goal.total > 0}
						<p class="next muted small">All milestones done.</p>
					{/if}
					<p class="facts small">
						<span class="num" data-testid="goal-hours">{formatDuration(goal.weekMinutes, ' ')} this week</span>
						{#if goal.due > 0}
							<a class="num" href="{base}/review?goal={goal.slug}" data-testid="goal-due">{goal.due} {goal.due === 1 ? 'card' : 'cards'} due</a>
						{:else}
							<span class="muted">no cards due</span>
						{/if}
					</p>
					{#if goal.reading.length}
						<ul class="reading" data-testid="goal-reading">
							{#each goal.reading as item (item.line)}
								<li>
									<Icon name="book-open" size={13} />
									{#if item.url}<a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>{:else}{item.title}{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
			{#if loose}
				<div class="goal" data-testid="goal-none">
					<div class="head"><span class="name muted">No goal</span></div>
					<p class="facts small">
						<span class="num">{formatDuration(data.study.unassigned.weekMinutes, ' ')} this week</span>
						<span class="num muted">{data.study.unassigned.due} {data.study.unassigned.due === 1 ? 'card' : 'cards'} due</span>
					</p>
					{#if data.study.unassigned.reading.length}
						<ul class="reading">
							{#each data.study.unassigned.reading as item (item.line)}
								<li><Icon name="book-open" size={13} /> {item.title}</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<p class="label">Folders</p>
	<FolderEditor slug={data.subject.slug} folders={data.subject.scope.folders ?? []} options={data.vaultFolders} />
</div>

<style>
	.grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s4); align-items: start; }

	.due-row { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
	.due-row .buttons { margin-left: auto; display: flex; gap: var(--s2); }
	/* The one figure on the page meant to be read from across the room. */
	.count { font-size: 34px; line-height: 1; font-weight: 600; font-variant-numeric: tabular-nums; }
	.empty { margin-top: var(--s2); }

	.bar { height: 6px; border-radius: var(--r-pill); background: var(--soft); overflow: hidden; margin-top: var(--s2); }
	.bar i { display: block; height: 100%; background: var(--accent); }
	.bar.small { height: 4px; margin-top: 6px; }

	.streak { display: flex; align-items: center; gap: 6px; margin: var(--s3) 0 0; color: var(--muted); font-size: var(--t13); }
	.streak :global(svg) { color: var(--sand-edge); }
	.streak b { color: var(--text); font-size: var(--t14); }

	.goal .head { display: flex; justify-content: space-between; gap: var(--s2); }
	.goal .name { font-weight: 500; }
	.goal .next { margin: 6px 0 0; }
	.facts { display: flex; gap: var(--s3); flex-wrap: wrap; margin: 6px 0 0; }
	.reading { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; font-size: var(--t13); }
	.reading li { display: flex; align-items: center; gap: 6px; }
	.reading :global(svg) { color: var(--muted); flex: none; }

	@media (max-width: 1100px) {
		.grid { grid-template-columns: 1fr; }
	}
</style>
