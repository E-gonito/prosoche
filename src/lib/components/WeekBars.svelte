<script lang="ts">
	/**
	 * A calm bar-per-week chart: one hue, a square baseline, rounded tops. No
	 * chart library — eight bars is not worth one. Single series, so no legend;
	 * the current week carries a direct label, and every bar's exact value is a
	 * native tooltip and an `aria-label`, so nothing is reachable only by eye.
	 */
	import { formatDuration } from '$lib/shared/duration';

	let { weeks }: { weeks: Array<{ start: string; minutes: number }> } = $props();

	const W = 600;
	const H = 120;
	const BASELINE = H - 18;
	const TOP_PAD = 20;
	const RADIUS = 4;
	const max = $derived(Math.max(1, ...weeks.map((w) => w.minutes)));
	const band = $derived(W / Math.max(1, weeks.length));
	const barW = $derived(Math.min(24, band * 0.6));

	function barPath(x: number, height: number): string {
		if (height <= 0) return '';
		const y = BASELINE - height;
		const r = Math.min(RADIUS, height, barW / 2);
		return [
			`M ${x} ${BASELINE}`,
			`L ${x} ${y + r}`,
			`Q ${x} ${y} ${x + r} ${y}`,
			`L ${x + barW - r} ${y}`,
			`Q ${x + barW} ${y} ${x + barW} ${y + r}`,
			`L ${x + barW} ${BASELINE}`,
			'Z'
		].join(' ');
	}

	/** `Sep 7`, short enough to sit under an 8-bar chart without crowding. */
	function label(day: string): string {
		const [, m, d] = day.split('-').map(Number);
		return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}`;
	}
</script>

<svg viewBox="0 0 {W} {H}" data-testid="week-chart" role="img" aria-label="Study time, the last {weeks.length} weeks">
	<line x1="0" y1={BASELINE} x2={W} y2={BASELINE} class="baseline" />
	{#each weeks as week, i (week.start)}
		{@const x = i * band + (band - barW) / 2}
		{@const height = (week.minutes / max) * (BASELINE - TOP_PAD)}
		<g>
			<path class="bar" d={barPath(x, height)}>
				<title>{label(week.start)}: {formatDuration(week.minutes, ' ')}</title>
			</path>
			{#if i === weeks.length - 1 && week.minutes > 0}
				<text x={x + barW / 2} y={BASELINE - height - 6} class="value" text-anchor="middle">{formatDuration(week.minutes, ' ')}</text>
			{/if}
			<text x={x + barW / 2} y={H - 4} class="tick" text-anchor="middle">{label(week.start)}</text>
		</g>
	{/each}
</svg>

<style>
	svg { width: 100%; height: auto; display: block; }
	.baseline { stroke: var(--line); stroke-width: 1; }
	.bar { fill: var(--accent); }
	.value { font: 600 10px var(--sans); fill: var(--text); }
	.tick { font: 10px var(--sans); fill: var(--muted); }
</style>
