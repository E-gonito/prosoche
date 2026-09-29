<script lang="ts">
	/**
	 * Stats: totals and rates over three ranges, a twelve-week trend, the best
	 * day of the week, and the Insights button.
	 *
	 * The trend is a small inline SVG — two thin lines, no library — built
	 * from `data.trend`, which the server already reduced to one point per
	 * week. Definitions sit in small print under each card, per the artifact's
	 * own caution about a match rate that only counts likes the user sent.
	 */
	let { data } = $props();

	interface Range {
		days: number;
		totals: { sent: number; matches: number; type: number; received: number };
		matchRate: number | null;
		typeRate: number | null;
		receivedPerDay: number | null;
	}

	const CARDS: Array<{ key: '7d' | '30d' | 'all'; title: string }> = [
		{ key: '7d', title: 'Last 7 days' },
		{ key: '30d', title: 'Last 30 days' },
		{ key: 'all', title: 'All time' }
	];

	function pct(n: number | null): string {
		return n === null ? '—' : `${Math.round(n * 100)}%`;
	}
	function per(n: number | null): string {
		return n === null ? '—' : n.toFixed(1);
	}

	// --- the trend chart: pure geometry, no library --------------------------
	const W = 640;
	const H = 170;
	const PAD = { top: 10, right: 8, bottom: 20, left: 8 };
	const plotW = W - PAD.left - PAD.right;
	const plotH = H - PAD.top - PAD.bottom;

	const maxValue = $derived(
		Math.max(1, ...data.trend.flatMap((w: { sent: number; matches: number }) => [w.sent, w.matches]))
	);
	const stepX = $derived(data.trend.length > 1 ? plotW / (data.trend.length - 1) : 0);
	const y = (v: number) => PAD.top + plotH - (v / maxValue) * plotH;
	const x = (i: number) => PAD.left + i * stepX;

	const sentPoints = $derived(data.trend.map((w: { sent: number }, i: number) => `${x(i)},${y(w.sent)}`).join(' '));
	const matchPoints = $derived(
		data.trend.map((w: { matches: number }, i: number) => `${x(i)},${y(w.matches)}`).join(' ')
	);

	function short(day: string): string {
		const [, m, d] = day.split('-');
		return `${d}/${m}`;
	}

	// --- Insights --------------------------------------------------------
	let asking = $state(false);
	let insight = $state<{ text: string; problem: string | null } | null>(null);

	async function askInsights() {
		if (asking) return;
		asking = true;
		insight = null;
		try {
			const res = await fetch('/api/dating/insights', { method: 'POST' });
			insight = await res.json();
		} catch {
			insight = { text: '', problem: 'No connection.' };
		} finally {
			asking = false;
		}
	}
</script>

<svelte:head><title>Stats · Dating · prosoche</title></svelte:head>

<div class="cards" data-testid="dating-stats-cards">
	{#each CARDS as card (card.key)}
		{@const r = data.ranges[card.key] as Range}
		<div class="sheet card-stat" data-testid="dating-range-{card.key}">
			<p class="label">{card.title}</p>
			<div class="kv">
				<b>Likes sent</b><span class="num">{r.totals.sent}</span>
				<b>Matches</b><span class="num">{r.totals.matches}</span>
				<b>Your type</b><span class="num">{r.totals.type}</span>
				<b>Likes received</b><span class="num">{r.totals.received}</span>
				<b>Match rate</b><span class="num" data-testid="dating-match-rate-{card.key}">{pct(r.matchRate)}</span>
				<b>Type rate</b><span class="num">{pct(r.typeRate)}</span>
				<b>Received / day</b><span class="num">{per(r.receivedPerDay)}</span>
			</div>
		</div>
	{/each}
</div>

<p class="hint definitions">
	<b>Match rate</b> is matches divided by likes sent, counting only matches from your own likes — liking back an
	incoming like is not a match "from" a like you sent, so it is excluded here and would otherwise read the rate
	higher than it is. <b>Type rate</b> is, of those matches, how many you marked as your type. <b>Received / day</b>
	is incoming likes divided by the days the range covers.
</p>

<p class="label">Weekly trend <span class="right muted small">last {data.trend.length} weeks</span></p>
<div class="sheet trend-card">
	<svg viewBox="0 0 {W} {H}" role="img" aria-label="Likes sent and matches per week, last {data.trend.length} weeks">
		{#each [0.25, 0.5, 0.75, 1] as f (f)}
			<line x1={PAD.left} x2={W - PAD.right} y1={y(maxValue * f)} y2={y(maxValue * f)} class="grid" />
		{/each}
		<polyline points={sentPoints} class="line sent" />
		<polyline points={matchPoints} class="line matches" />
		{#each data.trend as w, i (w.weekStart)}
			<g>
				<circle cx={x(i)} cy={y(w.sent)} r="8" class="hit" />
				<circle cx={x(i)} cy={y(w.sent)} r="3" class="dot sent" />
				<title>Week of {w.weekStart}: {w.sent} sent</title>
			</g>
			<g>
				<circle cx={x(i)} cy={y(w.matches)} r="8" class="hit" />
				<circle cx={x(i)} cy={y(w.matches)} r="3" class="dot matches" />
				<title>Week of {w.weekStart}: {w.matches} matches</title>
			</g>
			{#if i === 0}
				<text x={x(i)} y={H - 4} class="axis" text-anchor="start">{short(w.weekStart)}</text>
			{:else if i === data.trend.length - 1}
				<text x={x(i)} y={H - 4} class="axis" text-anchor="end">{short(w.weekEnd)}</text>
			{/if}
		{/each}
	</svg>
	<div class="legend">
		<span><i class="swatch sent"></i>Likes sent</span>
		<span><i class="swatch matches"></i>Matches</span>
	</div>
</div>

{#if data.bestDay}
	<p class="hint">Best day of the week for matches: <b>{data.bestDay.weekday}</b> ({data.bestDay.matches} total).</p>
{/if}

<p class="label">Insights</p>
<div class="sheet insights">
	<button class="btn" onclick={askInsights} disabled={asking} data-testid="dating-ask-insights">
		{asking ? 'Reading…' : 'Ask Claude for a read on patterns'}
	</button>
	{#if insight?.problem}
		<p class="problem" data-testid="dating-insights-problem">{insight.problem}</p>
	{:else if insight?.text}
		<p class="prose" data-testid="dating-insights-text">{insight.text}</p>
	{/if}
</div>

<style>
	.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s4); margin-bottom: var(--s3); }
	.card-stat .kv { grid-template-columns: 1fr auto; }
	.definitions { margin-bottom: var(--s3); }

	.trend-card { padding: var(--s4); }
	svg { width: 100%; height: auto; display: block; }
	.grid { stroke: var(--line); stroke-width: 1; }
	.line { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
	.line.sent { stroke: var(--sand-edge); }
	.line.matches { stroke: var(--accent); }
	.dot { stroke: var(--panel); stroke-width: 1.5; }
	.dot.sent { fill: var(--sand-edge); }
	.dot.matches { fill: var(--accent); }
	.hit { fill: transparent; }
	.axis { font-size: 9px; fill: var(--muted); }

	.legend { display: flex; gap: var(--s4); margin-top: var(--s2); font-size: var(--t13); color: var(--muted); }
	.legend span { display: inline-flex; align-items: center; gap: 6px; }
	.swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
	.swatch.sent { background: var(--sand-edge); }
	.swatch.matches { background: var(--accent); }

	.insights .btn { margin-bottom: var(--s2); }
	.insights .prose { font-size: var(--t14); white-space: pre-wrap; }

	@media (max-width: 720px) {
		.cards { grid-template-columns: 1fr; }
	}
</style>
