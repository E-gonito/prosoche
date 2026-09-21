<script lang="ts">
	/**
	 * This week's planned time against the time actually logged.
	 *
	 * One row per day, with the plan as a track and what was logged filled in
	 * over it, so an under-run and an over-run look different at a glance. Bars
	 * are scaled to the busiest day of the week rather than to a fixed number of
	 * hours, because a week of two-hour days should not render as seven slivers.
	 */
	import Unavailable from './Unavailable.svelte';
	import { formatDuration } from '$lib/shared/duration';
	import type { LoadedWidget } from '$lib/shared/widgets';

	interface Day {
		day: string;
		plannedMinutes: number;
		loggedMinutes: number;
	}
	interface Data {
		days: Day[];
		plannedMinutes: number;
		loggedMinutes: number;
		byWorkspace: Array<{ slug: string; name: string; color: string; minutes: number }>;
		byQuadrant: Array<{ quadrant: number | null; minutes: number }>;
		unmatched: Array<{ text: string; minutes: number }>;
		scoped: boolean;
		today: string;
		workspace: string | null;
	}

	let { widget }: { widget: LoadedWidget; refresh?: () => void } = $props();

	const data = $derived(widget.data as Data | null);
	const scale = $derived(Math.max(60, ...(data?.days ?? []).flatMap((d) => [d.plannedMinutes, d.loggedMinutes])));

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
			<b data-testid="logged-total">{formatDuration(data.loggedMinutes)}</b> logged
			<span class="muted">of {formatDuration(data.plannedMinutes)} planned</span>
		</p>

		<ul class="days">
			{#each data.days as d (d.day)}
				<li class:today={d.day === data.today}>
					<span class="dow">{weekday(d.day)}</span>
					<span class="bars" title="{formatDuration(d.loggedMinutes)} logged, {formatDuration(d.plannedMinutes)} planned">
						<span class="planned" style="width: {percent(d.plannedMinutes)}"></span>
						<span class="logged" style="width: {percent(d.loggedMinutes)}"></span>
					</span>
					<span class="mins">{d.loggedMinutes ? formatDuration(d.loggedMinutes) : ''}</span>
				</li>
			{/each}
		</ul>

		{#if data.byWorkspace.length > 1 || (data.byWorkspace.length === 1 && !data.scoped)}
			<ul class="split">
				{#each data.byWorkspace as w (w.slug)}
					<li><i style="--dot: {w.color}"></i>{w.name}<b>{formatDuration(w.minutes)}</b></li>
				{/each}
			</ul>
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

		{#if !data.loggedMinutes}
			<p class="hint">
				Nothing logged{data.workspace ? ` against ${data.workspace}` : ''} this week. Start a timer on a
				task and stopping it writes a line under <code>## Time log</code>.
			</p>
		{/if}
	</div>
{/if}

<style>
	.totals { margin: 0 0 10px; font-size: 13px; }
	.totals b { font-size: 15px; }
	.days { list-style: none; margin: 0; padding: 0; }
	.days li { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
	.days .today .dow { color: var(--accent); font-weight: 700; }
	.dow { flex: none; width: 30px; font: 11px var(--mono); color: var(--muted); }
	.bars { position: relative; flex: 1; height: 12px; min-width: 0; }
	.bars span {
		position: absolute;
		left: 0;
		border-radius: 3px;
		display: block;
	}
	.planned { top: 0; height: 12px; background: var(--soft); border: 1px solid var(--line); }
	.logged { top: 2px; height: 8px; background: var(--accent); }
	.mins { flex: none; width: 52px; text-align: right; font: 11px var(--mono); color: var(--muted); }

	.split { list-style: none; margin: 10px 0 0; padding: 0; font-size: 12px; }
	.split li { display: flex; align-items: center; gap: 6px; padding: 2px 0; color: var(--muted); }
	.split b { margin-left: auto; font: 11px var(--mono); color: var(--text); }
	.split i { width: 8px; height: 8px; border-radius: 50%; background: var(--dot); flex: none; }
	.quadrants li { display: inline-flex; margin-right: 12px; }
	.quadrants b { margin-left: 4px; }
	.unplanned { overflow: hidden; }
	.hint { margin: 10px 0 0; }
	.hint code { font: 11px var(--mono); background: var(--soft); border-radius: 4px; padding: 1px 4px; }
</style>
