<script lang="ts">
	/**
	 * This week's planned time against the time that actually happened.
	 *
	 * Two things say work happened, and they are drawn apart rather than added
	 * into one number: a ticked timed block, which is the user saying the block
	 * went as planned, and a timer, which measured it. One row per day, with the
	 * plan as a track, the ticked time filled in over it and the timed time
	 * darker on top, so an under-run and an over-run look different at a glance.
	 * Bars are scaled to the busiest day of the week rather than to a fixed
	 * number of hours, because a week of two-hour days should not render as
	 * seven slivers.
	 */
	import Unavailable from './Unavailable.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { formatDuration } from '$lib/shared/duration';
	import type { LoadedWidget } from '$lib/shared/widgets';

	interface Day {
		day: string;
		plannedMinutes: number;
		doneMinutes: number;
		loggedMinutes: number;
	}
	interface Data {
		days: Day[];
		plannedMinutes: number;
		doneMinutes: number;
		/** Timer minutes only, which is what "timed" means everywhere here. */
		loggedMinutes: number;
		byWorkspace: Array<{ slug: string; name: string; color: string; minutes: number; timedMinutes: number }>;
		byQuadrant: Array<{ quadrant: number | null; minutes: number }>;
		unmatched: Array<{ text: string; minutes: number }>;
		scoped: boolean;
		today: string;
		workspace: string | null;
	}

	let { widget }: { widget: LoadedWidget; refresh?: () => void } = $props();

	const data = $derived(widget.data as Data | null);
	const scale = $derived(
		Math.max(60, ...(data?.days ?? []).flatMap((d) => [d.plannedMinutes, d.doneMinutes + d.loggedMinutes]))
	);
	const tracked = $derived((data?.doneMinutes ?? 0) + (data?.loggedMinutes ?? 0));
	// A short block of one project inside a long block of another belongs to
	// both, so the columns can add up to more than the week did. Said once,
	// and only on the weeks where it is true.
	const nested = $derived((data?.byWorkspace ?? []).reduce((sum, w) => sum + w.minutes, 0) > tracked);

	function weekday(day: string): string {
		const [y, m, d] = day.split('-').map(Number);
		return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' });
	}
	const percent = (minutes: number) => `${Math.round((minutes / scale) * 100)}%`;
</script>

{#if !data}
	<Unavailable {widget} />
{:else}
	<div class="time" data-testid="time-widget">
		<p class="totals">
			<b data-testid="done-total">{formatDuration(data.doneMinutes)}</b> done ·
			<b data-testid="logged-total">{formatDuration(data.loggedMinutes)}</b> timed
			<span class="muted">· of {formatDuration(data.plannedMinutes)} planned</span>
		</p>

		<ul class="days">
			{#each data.days as d (d.day)}
				<li class:today={d.day === data.today}>
					<span class="dow">{weekday(d.day)}</span>
					<span
						class="bars"
						title="{formatDuration(d.doneMinutes)} done, {formatDuration(d.loggedMinutes)} timed, {formatDuration(
							d.plannedMinutes
						)} planned"
					>
						<span class="planned" style="width: {percent(d.plannedMinutes)}"></span>
						<span class="done" style="width: {percent(d.doneMinutes)}"></span>
						<span class="timed" style="width: {percent(d.loggedMinutes)}"></span>
					</span>
					<span class="mins">
						{d.doneMinutes + d.loggedMinutes ? formatDuration(d.doneMinutes + d.loggedMinutes) : ''}
					</span>
				</li>
			{/each}
		</ul>

		{#if data.byWorkspace.length > 1 || (data.byWorkspace.length === 1 && !data.scoped)}
			<ul class="split">
				{#each data.byWorkspace as w (w.slug)}
					<li>
						<i style="--dot: {w.color}"></i>{w.name}
						{#if w.timedMinutes && w.timedMinutes < w.minutes}
							<span class="of">
								{formatDuration(w.minutes - w.timedMinutes)} done · {formatDuration(w.timedMinutes)} timed
							</span>
						{/if}
						<b>{formatDuration(w.minutes)}</b>
					</li>
				{/each}
			</ul>
			{#if nested}
				<p class="hint">A block inside another counts for both, so these add up to more than the week.</p>
			{/if}
		{/if}

		{#if data.byQuadrant.length}
			<ul class="split quadrants">
				{#each data.byQuadrant as q (q.quadrant ?? 0)}
					<li>
						{#if q.quadrant}<span class="q q{q.quadrant}">Q{q.quadrant}</span>{:else}<span class="q q4">—</span>{/if}
						<b>{formatDuration(q.minutes)}</b>
					</li>
				{/each}
			</ul>
		{/if}

		{#if data.unmatched.length}
			<p class="hint">Logged but not planned</p>
			<ul class="split">
				{#each data.unmatched as u (u.text)}
					<li class="unplanned">{u.text}<b>{formatDuration(u.minutes)}</b></li>
				{/each}
			</ul>
		{/if}

		{#if !tracked}
			<EmptyState
				icon="calendar"
				title="Nothing ticked or timed{data.workspace ? ` against ${data.workspace}` : ''} this week."
				hint="Ticking a timed block counts as done; so does starting a timer and stopping it."
			/>
		{/if}
	</div>
{/if}

<style>
	.totals { margin: 0 0 10px; font-size: var(--t13); }
	.totals b { font-size: 15px; }
	.days { list-style: none; margin: 0; padding: 0; }
	.days li { display: flex; align-items: center; gap: var(--s2); padding: 2px 0; }
	.days .today .dow { color: var(--accent); font-weight: 700; }
	/* A day label and a count of minutes: body text, figures lined up. */
	.dow { flex: none; width: 30px; font-size: var(--t11); font-variant-numeric: tabular-nums; color: var(--muted); }
	.bars { position: relative; flex: 1; height: var(--s3); min-width: 0; }
	.bars span {
		position: absolute;
		left: 0;
		border-radius: 3px;
		display: block;
	}
	.planned { top: 0; height: var(--s3); background: var(--soft); border: 1px solid var(--line); }
	/* Ticked time fills the plan; timed time sits darker on top of it. */
	.done { top: 2px; height: var(--s2); background: var(--accent); opacity: 0.35; }
	.timed { top: 4px; height: var(--s1); background: var(--accent); }
	.mins { flex: none; width: 52px; text-align: right; font-size: var(--t11); font-variant-numeric: tabular-nums; color: var(--muted); }

	.split { list-style: none; margin: 10px 0 0; padding: 0; font-size: var(--t12); }
	.split li { display: flex; align-items: center; gap: 6px; padding: 2px 0; color: var(--muted); }
	.split b { margin-left: auto; font-size: var(--t11); font-variant-numeric: tabular-nums; color: var(--text); }
	.split i { width: var(--s2); height: var(--s2); border-radius: 50%; background: var(--dot); flex: none; }
	.split .of { font-size: var(--t11); font-variant-numeric: tabular-nums; }
	.quadrants li { display: inline-flex; margin-right: var(--s3); }
	.quadrants b { margin-left: var(--s1); }
	.unplanned { overflow: hidden; }
	.hint { margin: 10px 0 0; }
</style>
