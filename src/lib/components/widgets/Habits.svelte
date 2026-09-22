<script lang="ts">
	/**
	 * The daily habits. The question this answers at a glance is "have I done
	 * today's yet", so today's checkbox is the first thing on every row and
	 * the streak is the second.
	 */
	import Icon from '$lib/components/Icon.svelte';
	import Unavailable from './Unavailable.svelte';
	import { editTask, type Task } from '$lib/client/api';
	import type { Habit } from '$lib/client/study';
	import type { LoadedWidget } from '$lib/shared/widgets';

	let { widget, refresh }: { widget: LoadedWidget; refresh?: () => void } = $props();

	const data = $derived(widget.data as { today: string; habits: Habit[]; doneToday: number; ofToday: number } | null);
	let problem = $state('');
	let busy = $state('');
	let all = $state(false);

	/** Today's slice of the strip: a fortnight fits a narrow card. */
	const STRIP = 14;
	const visible = $derived(data ? (all ? data.habits : data.habits.filter((h) => h.today !== null)) : []);

	async function toggle(habit: Habit) {
		if (!habit.path || habit.line === null || habit.raw === null) return;
		busy = habit.text;
		// The task API works from path, line and the line as last seen; that is
		// all a habit row has, and all it needs.
		const task = { path: habit.path, line: habit.line, raw: habit.raw } as Task;
		const result = await editTask(task, { status: habit.today ? 'todo' : 'done' });
		busy = '';
		if (result.ok) refresh?.();
		else problem = result.message;
	}
</script>

{#if !data}
	<Unavailable {widget} />
{:else if data.habits.length === 0}
	<p class="none">No habits yet. Tasks in your daily note template become habits.</p>
{:else}
	<div data-testid="habits">
		<p class="score" data-testid="habits-score">{data.doneToday} of {data.ofToday} done today</p>
		<ul>
			{#each visible as habit (habit.text)}
				<li data-testid="habit" class:busy={busy === habit.text} class:done={habit.today === true}>
					<button
						class="box"
						data-testid="habit-check"
						disabled={habit.today === null || busy === habit.text}
						aria-pressed={habit.today === true}
						aria-label={habit.today ? `Mark "${habit.text}" not done` : `Mark "${habit.text}" done`}
						onclick={() => toggle(habit)}
					>{habit.today ? '✓' : ''}</button>
					<span class="text" title={habit.text}>{habit.text}</span>
					<span class="strip" aria-hidden="true">
						{#each habit.days.slice(-STRIP) as day (day.day)}
							<i class:on={day.done === true} class:off={day.done === false} title={day.day}></i>
						{/each}
					</span>
					<span class="streak" title="{habit.hit} of {habit.of} days written">
						{habit.streak}<Icon name="flame" size={12} />
					</span>
				</li>
			{/each}
		</ul>
		{#if data.habits.length > visible.length || all}
			<button class="btn ghost more" onclick={() => (all = !all)}>{all ? 'Only today’s' : `All ${data.habits.length}`}</button>
		{/if}
		{#if problem}<p class="problem">{problem}</p>{/if}
	</div>
{/if}

<style>
	.score { margin: 0 0 var(--s2); font-size: var(--t13); color: var(--muted); }
	ul { list-style: none; margin: 0; padding: 0; }
	li { display: flex; align-items: center; gap: var(--s2); padding: 5px 0; border-top: 1px solid var(--line); }
	li:first-child { border-top: 0; }
	.busy { opacity: 0.5; }
	.box {
		flex: none;
		width: var(--s4);
		height: var(--s4);
		padding: 0;
		border: 1.5px solid #9aa0a6;
		border-radius: 3px;
		background: var(--field);
		font-size: var(--t11);
		line-height: 1;
		color: #fff;
		cursor: pointer;
	}
	.box:disabled { opacity: 0.4; cursor: default; }
	.done .box { background: var(--accent); border-color: var(--accent); }
	.done .text { color: var(--muted); }
	.text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--t13); }
	.strip { flex: none; display: flex; gap: 2px; }
	.strip i { width: 6px; height: var(--s3); border-radius: 2px; background: var(--soft); }
	.strip i.on { background: var(--ok); }
	.strip i.off { background: #e6b8b8; }
	.streak {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 2px;
		min-width: 26px;
		font-size: var(--t11);
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}
	.more { margin-top: 6px; font-size: var(--t12); padding: 2px var(--s2); }
	/* `.none` and `.problem` are shared, in app.css. */
	@media (max-width: 720px) {
		.strip { display: none; }
	}
</style>
