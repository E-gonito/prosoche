<script lang="ts">
	/**
	 * Study at a glance: what to review right now, the goals under way, this
	 * week's time, the streak, and what is currently being read.
	 */
	import StudyTabs from '$lib/components/StudyTabs.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { noteHref } from '$lib/shared/links';
	import { formatDuration } from '$lib/shared/duration';

	let { data } = $props();

	const weekTarget = $derived(data.weeklyHours ? data.weeklyHours * 60 : null);
	const weekPct = $derived(weekTarget ? Math.min(100, Math.round((data.weekMinutes / weekTarget) * 100)) : null);
</script>

<svelte:head><title>Study · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Study</h1>
		<p>Goals, sessions and cards — all read straight from the vault.</p>
	</div>

	<StudyTabs tabs={data.tabs} />

	<div class="grid">
		<section class="sheet">
			<p class="label">Flashcards</p>
			<div class="due-row">
				<span class="count" data-testid="due-count">{data.due}</span>
				<span class="muted">
					due now{data.fresh > 0 ? `, ${data.fresh} new` : ''}
				</span>
				{#if data.due > 0}
					<a class="btn primary" href="/study/review" data-testid="review-link">Review</a>
				{/if}
			</div>
			{#if data.due === 0}<p class="none">Nothing due right now.</p>{/if}
		</section>

		<section class="sheet">
			<p class="label">
				This week
				<span class="right num" data-testid="week-time">
					{formatDuration(data.weekMinutes, ' ')}{weekTarget ? ` of ${formatDuration(weekTarget, ' ')}` : ''}
				</span>
			</p>
			{#if weekPct !== null}
				<div class="bar"><i style="width: {weekPct}%"></i></div>
			{/if}
			<p class="streak" data-testid="streak">
				<Icon name="flame" size={15} label="Streak" />
				<b class="num">{data.streak}</b> {data.streak === 1 ? 'day' : 'days'} in a row
			</p>
		</section>

		<section class="sheet goals" data-testid="goals-summary">
			<p class="label">Goals<span class="right"><a href="/study/goals">Open</a></span></p>
			{#if data.goals.length === 0}
				<p class="none">No goals yet. <a href="/study/goals">Add one</a>.</p>
			{:else}
				<div class="rows">
					{#each data.goals as goal (goal.title)}
						<div class="goal" data-testid="goal">
							<div class="head">
								<span class="name">{goal.title}</span>
								<span class="muted small num">{goal.done} of {goal.total}</span>
							</div>
							<div class="bar small"><i style="width: {goal.total ? Math.round((goal.done / goal.total) * 100) : 0}%"></i></div>
							{#if goal.next}
								<p class="next muted small">Next: {goal.next.text}{goal.next.due ? ` · 📅 ${goal.next.due}` : ''}</p>
							{:else if goal.total > 0}
								<p class="next muted small">All milestones done.</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>

		{#if data.currentlyReading}
			<section class="sheet">
				<p class="label">Currently reading</p>
				<a class="reading" href={noteHref(data.currentlyReading.path)} data-testid="currently-reading">
					<span class="name">{data.currentlyReading.title}</span>
					<span class="muted small">{data.currentlyReading.kind}</span>
				</a>
			</section>
		{/if}

		{#if data.topics.length > 0}
			<section class="sheet">
				<p class="label">Topics</p>
				<p class="chips">
					{#each data.topics as topic (topic.name)}
						<span class="chip quiet">{topic.name} <span class="num muted">{topic.notes}</span></span>
					{/each}
				</p>
			</section>
		{/if}
	</div>
</div>

<style>
	.grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s4); align-items: start; }
	.goals { grid-column: 1 / -1; }

	.due-row { display: flex; align-items: center; gap: var(--s3); }
	.count { font-size: 34px; line-height: 1; font-weight: 600; font-variant-numeric: tabular-nums; }
	.none { margin-top: var(--s2); }

	.bar { height: 6px; border-radius: var(--r-pill); background: var(--soft); overflow: hidden; margin-top: var(--s2); }
	.bar i { display: block; height: 100%; background: var(--accent); }
	.bar.small { height: 4px; margin-top: 6px; }

	.streak { display: flex; align-items: center; gap: 6px; margin: var(--s3) 0 0; color: var(--muted); font-size: var(--t13); }
	.streak :global(svg) { color: var(--sand-edge); }
	.streak b { color: var(--text); font-size: var(--t14); }

	.goal + .goal { margin-top: var(--s3); }
	.goal .head { display: flex; justify-content: space-between; gap: var(--s2); }
	.goal .name { font-weight: 500; }
	.goal .next { margin: 6px 0 0; }

	.reading { display: flex; flex-direction: column; gap: 2px; color: var(--text); }
	.reading:hover { text-decoration: none; }
	.reading .name { font-weight: 500; }
	.reading:hover .name { color: var(--accent); }

	.chips { display: flex; flex-wrap: wrap; gap: 6px; }

	@media (max-width: 1100px) {
		.grid { grid-template-columns: 1fr; }
		.goals { grid-column: auto; }
	}
</style>
