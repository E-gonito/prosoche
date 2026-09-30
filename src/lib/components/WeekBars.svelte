<script lang="ts" module>
	/** One column of the chart. */
	export interface Bar {
		key: string;
		/** Under the bar: `Sep 7`, `Mon`. */
		label: string;
		value: number;
		/** Drawn behind `value` when given. */
		total?: number;
		/** The exact reading: `3h 20m`, `4 of 9 done`. */
		text: string;
		href?: string;
	}
</script>

<script lang="ts">
	/**
	 * A calm bar chart: one hue, a square baseline, rounded tops. No chart
	 * library; a handful of bars is not worth one. A bar with a `total` is
	 * drawn as the total in the soft tint with the value inside it in the
	 * accent, so "done against planned" reads as how full each column is.
	 * The `marked` bar carries a direct label; every bar's exact value is a
	 * native tooltip and in the chart's text, so nothing is reachable only by
	 * eye. A bar with an `href` is a link.
	 *
	 * Used by Study for minutes a week and by Today for the seven days of the
	 * week, done against planned.
	 */
	let {
		bars,
		label,
		marked = bars.at(-1)?.key,
		width = 600
	}: {
		bars: Bar[];
		label: string;
		marked?: string;
		/** The drawing's width in its own units: near the width it is shown at keeps the type readable. */
		width?: number;
	} = $props();

	const W = $derived(width);
	const H = 120;
	const BASELINE = H - 18;
	const TOP_PAD = 20;
	const RADIUS = 4;
	const max = $derived(Math.max(1, ...bars.map((b) => Math.max(b.value, b.total ?? 0))));
	const band = $derived(W / Math.max(1, bars.length));
	const barW = $derived(Math.min(bars.some((b) => b.total !== undefined) ? 40 : 24, band * 0.6));
	const height = (n: number) => (n / max) * (BASELINE - TOP_PAD);

	function barPath(x: number, h: number): string {
		if (h <= 0) return '';
		const y = BASELINE - h;
		const r = Math.min(RADIUS, h, barW / 2);
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
</script>

{#snippet column(bar: Bar, i: number)}
	{@const x = i * band + (band - barW) / 2}
	{@const top = height(Math.max(bar.value, bar.total ?? 0))}
	<title>{bar.label}: {bar.text}</title>
	<rect x={i * band} y="0" width={band} height={H} class="hit" />
	{#if bar.total !== undefined}<path class="bar total" d={barPath(x, height(bar.total))} />{/if}
	<path class="bar" d={barPath(x, height(bar.value))} />
	{#if bar.key === marked && top > 0}
		<text x={x + barW / 2} y={BASELINE - top - 6} class="value" text-anchor="middle">{bar.text}</text>
	{/if}
	<text x={x + barW / 2} y={H - 4} class="axis" class:marked={bar.key === marked} text-anchor="middle">{bar.label}</text>
{/snippet}

<svg viewBox="0 0 {W} {H}" data-testid="week-chart" role="img" aria-label={label}>
	<line x1="0" y1={BASELINE} x2={W} y2={BASELINE} class="baseline" />
	{#each bars as bar, i (bar.key)}
		{#if bar.href}
			<a href={bar.href} data-testid="week-bar" aria-label="{bar.label}: {bar.text}">{@render column(bar, i)}</a>
		{:else}
			<g data-testid="week-bar">{@render column(bar, i)}</g>
		{/if}
	{/each}
</svg>

<style>
	svg { width: 100%; height: auto; display: block; }
	.baseline { stroke: var(--line); stroke-width: 1; }
	.hit { fill: transparent; }
	.bar { fill: var(--accent); }
	.bar.total { fill: var(--accent-soft); }
	a:hover .bar.total { fill: var(--line); }
	.value { font: 600 10px var(--sans); fill: var(--text); }
	.axis { font: 10px var(--sans); fill: var(--muted); }
	.axis.marked { fill: var(--text); font-weight: 600; }
</style>
