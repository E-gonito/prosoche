<script lang="ts">
	/**
	 * A subject's goals and their milestones. Goals are the subject's topics:
	 * reading, sessions and card files point at one. A milestone is an
	 * ordinary task, so ticking one is the same rewrite `/api/task` does
	 * everywhere else in the hub.
	 */
	import StudyTabs from '$lib/components/StudyTabs.svelte';
	import { editTask, type Task } from '$lib/client/api';
	import { addGoal, addMilestone } from '$lib/client/study';
	import { isDone } from '$lib/shared/task';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let problem = $state('');
	// A patch layer over the server's data, so a tick shows at once rather than
	// waiting for a reload; see the day page for the same pattern.
	let patches = $state(new Map<string, Task>());
	const keyOf = (t: Task) => `${t.path}:${t.line}`;
	const milestonesOf = (goal: (typeof data.goals)[number]) => goal.milestones.map((m) => patches.get(keyOf(m)) ?? m);

	async function toggle(milestone: Task) {
		problem = '';
		const result = await editTask(milestone, { status: isDone(milestone) ? 'todo' : 'done' });
		if (result.ok) {
			const next = new Map(patches);
			next.set(keyOf(milestone), result.value);
			patches = next;
		} else {
			problem = result.message;
		}
	}

	let goalTitle = $state('');
	let goalTarget = $state('');
	let addingGoal = $state(false);

	async function submitGoal(event: Event) {
		event.preventDefault();
		const title = goalTitle.trim();
		if (!title || addingGoal) return;
		addingGoal = true;
		const result = await addGoal(data.subject.slug, title, goalTarget.trim() || null);
		addingGoal = false;
		if (result.ok) {
			goalTitle = '';
			goalTarget = '';
			await invalidateAll();
		} else {
			problem = result.message;
		}
	}

	let milestoneGoal = $state('');
	let milestoneText = $state('');
	let milestoneDue = $state('');
	let addingMilestone = $state(false);

	$effect(() => {
		if (!milestoneGoal && data.goals.length) milestoneGoal = data.goals[0].title;
	});

	async function submitMilestone(event: Event) {
		event.preventDefault();
		const text = milestoneText.trim();
		if (!text || !milestoneGoal || addingMilestone) return;
		addingMilestone = true;
		const result = await addMilestone(data.subject.slug, milestoneGoal, text, milestoneDue.trim() || null);
		addingMilestone = false;
		if (result.ok) {
			milestoneText = '';
			milestoneDue = '';
			await invalidateAll();
		} else {
			problem = result.message;
		}
	}
</script>

<svelte:head><title>Goals · {data.subject.name} · prosoche</title></svelte:head>

<div class="page">
	<StudyTabs
		subject={data.subject}
		lede={data.weeklyHours ? `Goals and the milestones on the way. A target of ${data.weeklyHours}h a week.` : 'Goals and the milestones on the way.'}
	/>

	{#if problem}<p class="problem">{problem}</p>{/if}

	<div class="sheet rows" data-testid="goals">
		{#each data.goals as goal (goal.title)}
			<div class="goal" data-testid="goal">
				<div class="head">
					<h3>{goal.title}</h3>
					{#if goal.target}<span class="badge muted num">📅 {goal.target}</span>{/if}
				</div>
				<div class="milestones">
					{#each milestonesOf(goal) as milestone (milestone.line)}
						<label class="milestone" data-testid="milestone">
							<input type="checkbox" checked={isDone(milestone)} onchange={() => toggle(milestone)} />
							<span class:done={isDone(milestone)}>{milestone.text}</span>
							{#if milestone.due}<span class="due muted small num">📅 {milestone.due}</span>{/if}
						</label>
					{:else}
						<p class="none">No milestones yet.</p>
					{/each}
				</div>
			</div>
		{:else}
			<p class="none">No goals yet. Add the first one below.</p>
		{/each}
	</div>

	<p class="label">Add a goal</p>
	<form class="row" onsubmit={submitGoal}>
		<input class="field" bind:value={goalTitle} placeholder="What are you working towards?" aria-label="Goal title" data-testid="goal-title" />
		<input class="field date" type="date" bind:value={goalTarget} aria-label="Target date" data-testid="goal-target" />
		<button class="btn primary" disabled={!goalTitle.trim() || addingGoal} data-testid="add-goal">Add goal</button>
	</form>

	{#if data.goals.length > 0}
		<p class="label">Add a milestone</p>
		<form class="row" onsubmit={submitMilestone}>
			<select class="field" bind:value={milestoneGoal} aria-label="Goal" data-testid="milestone-goal">
				{#each data.goals as goal (goal.title)}
					<option value={goal.title}>{goal.title}</option>
				{/each}
			</select>
			<input class="field" bind:value={milestoneText} placeholder="Milestone" aria-label="Milestone text" data-testid="milestone-text" />
			<input class="field date" type="date" bind:value={milestoneDue} aria-label="Due date" data-testid="milestone-due" />
			<button class="btn primary" disabled={!milestoneText.trim() || addingMilestone} data-testid="add-milestone">Add</button>
		</form>
	{/if}
</div>

<style>
	.goal + .goal { margin-top: var(--s2); }
	.head { display: flex; align-items: center; justify-content: space-between; gap: var(--s2); }
	.head h3 { margin: 0; font: 600 var(--t16) var(--serif); }

	.milestones { margin-top: var(--s2); display: flex; flex-direction: column; gap: 6px; }
	.milestone { display: flex; align-items: center; gap: var(--s2); font-size: var(--t14); cursor: pointer; }
	.milestone span.done { color: var(--muted); text-decoration: line-through; }
	.milestone .due { margin-left: auto; }
	.milestone input { flex: none; }

	.row { display: flex; flex-wrap: wrap; gap: var(--s2); margin-bottom: var(--s4); }
	.row .field { flex: 1; min-width: 160px; }
	.row .date { flex: none; width: 160px; }

	.problem { color: var(--bad); margin-bottom: var(--s3); }

	@media (max-width: 720px) {
		.row .field, .row .date { flex-basis: 100%; width: auto; }
	}
</style>
