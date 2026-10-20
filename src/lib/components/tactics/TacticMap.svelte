<script lang="ts">
	/**
	 * A `tactic-map` drawn top-down as SVG: the grid, walls, doors, the
	 * angles a clear-order drill asks about, and who is where.
	 *
	 * Nothing here relies on colour alone. Each kind of entity has its own
	 * shape (you a filled triangle, a teammate an open one, a suspect a
	 * square, an enemy a diamond, a civilian a circle) and a text label with
	 * its state under it. Angles are labelled with their id, and once picked
	 * with their place in the order.
	 *
	 * With `onpick`, each angle is a button: a click or Enter picks it. The
	 * drill owns the order and the keyboard; this only draws and reports.
	 */
	import type { Direction, EntityType, TacticMap } from '$lib/shared/tactics';

	let {
		map,
		picked = [],
		onpick
	}: {
		map: TacticMap;
		/** Angle ids picked so far, in order. */
		picked?: string[];
		onpick?: (id: string) => void;
	} = $props();

	/** Pixels per grid unit. The SVG scales to its box, so this only sets proportions. */
	const CELL = 40;
	const PAD = 24;
	const W = $derived(map.grid[0] * CELL + PAD * 2);
	const H = $derived(map.grid[1] * CELL + PAD * 2);
	const x = (gx: number) => PAD + gx * CELL;
	const y = (gy: number) => PAD + gy * CELL;

	const STEP: Record<Direction, [number, number]> = {
		N: [0, -1],
		NE: [0.7071, -0.7071],
		E: [1, 0],
		SE: [0.7071, 0.7071],
		S: [0, 1],
		SW: [-0.7071, 0.7071],
		W: [-1, 0],
		NW: [-0.7071, -0.7071]
	};
	const REACH = 1.6;

	const NAME: Record<EntityType, string> = { player: 'you', teammate: 'teammate', suspect: 'suspect', civilian: 'civilian', enemy: 'enemy' };

	function glyph(type: EntityType, cx: number, cy: number): string {
		const r = 9;
		switch (type) {
			case 'player':
			case 'teammate':
				return `M${cx} ${cy - r} L${cx + r} ${cy + r * 0.8} L${cx - r} ${cy + r * 0.8} Z`;
			case 'suspect':
				return `M${cx - r * 0.8} ${cy - r * 0.8} h${r * 1.6} v${r * 1.6} h${-r * 1.6} Z`;
			case 'enemy':
				return `M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`;
			case 'civilian':
				return `M${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx + r} ${cy} Z`;
		}
	}

	const label = (e: TacticMap['entities'][number]) => (e.state ? `${NAME[e.type]} · ${e.state}` : NAME[e.type]);
	const described = $derived(
		[
			`${map.grid[0]} by ${map.grid[1]} map.`,
			...map.entities.map((e) => `${label(e)} at ${e.at.join(', ')}.`),
			...map.doors.map((d) => `Door ${d.id} at ${d.at.join(', ')}.`),
			...map.angles.map((a) => `Angle ${a.id}, facing ${a.dir}.`)
		].join(' ')
	);
</script>

<svg class="map" viewBox="0 0 {W} {H}" role="img" aria-label={described} data-testid="tactic-map">
	<g class="grid">
		{#each { length: map.grid[0] + 1 } as _, i (i)}<line x1={x(i)} y1={y(0)} x2={x(i)} y2={y(map.grid[1])} />{/each}
		{#each { length: map.grid[1] + 1 } as _, i (i)}<line x1={x(0)} y1={y(i)} x2={x(map.grid[0])} y2={y(i)} />{/each}
	</g>

	{#each map.walls as w, i (i)}<line class="wall" x1={x(w[0])} y1={y(w[1])} x2={x(w[2])} y2={y(w[3])} />{/each}

	{#each map.doors as d (d.id)}
		<g class="door">
			<rect x={x(d.at[0]) - 7} y={y(d.at[1]) - 7} width="14" height="14" rx="3" />
			<text x={x(d.at[0])} y={y(d.at[1]) - 12}>{d.id}</text>
		</g>
	{/each}

	{#each map.angles as a (a.id)}
		{@const [dx, dy] = STEP[a.dir]}
		{@const tipX = x(a.from[0] + dx * REACH)}
		{@const tipY = y(a.from[1] + dy * REACH)}
		{@const place = picked.indexOf(a.id)}
		<line class="ray" x1={x(a.from[0])} y1={y(a.from[1])} x2={tipX} y2={tipY} />
		{#if onpick}
			<g
				class="angle pickable"
				class:picked={place >= 0}
				role="button"
				tabindex={place >= 0 ? -1 : 0}
				aria-label="Angle {a.id}{place >= 0 ? `, picked ${place + 1}` : ''}"
				aria-disabled={place >= 0}
				onclick={() => place < 0 && onpick?.(a.id)}
				onkeydown={(e) => {
					if ((e.key === 'Enter' || e.key === ' ') && place < 0) {
						e.preventDefault();
						onpick?.(a.id);
					}
				}}
				data-testid="angle-{a.id}"
			>
				<circle cx={tipX} cy={tipY} r="15" />
				<text x={tipX} y={tipY + 4}>{place >= 0 ? `${place + 1}·${a.id}` : a.id}</text>
			</g>
		{:else}
			<g class="angle">
				<circle cx={tipX} cy={tipY} r="15" />
				<text x={tipX} y={tipY + 4}>{a.id}</text>
			</g>
		{/if}
	{/each}

	{#each map.entities as e, i (i)}
		<g class="entity {e.type}">
			<path d={glyph(e.type, x(e.at[0]), y(e.at[1]))} />
			<text x={x(e.at[0])} y={y(e.at[1]) + 24}>{label(e)}</text>
		</g>
	{/each}
</svg>

<style>
	.map { display: block; width: 100%; max-height: 52vh; background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-lg); }
	.grid line { stroke: var(--line); stroke-width: 1; }
	.wall { stroke: var(--text); stroke-width: 4; stroke-linecap: square; }
	.door rect { fill: var(--sand); stroke: var(--sand-edge); stroke-width: 2; }
	.door text { font: 600 11px var(--sans); fill: var(--sand-edge); text-anchor: middle; }
	.ray { stroke: var(--accent); stroke-width: 2; stroke-dasharray: 4 3; }
	.angle circle { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 2; }
	.angle text { font: 700 11px var(--sans); fill: var(--accent); text-anchor: middle; pointer-events: none; }
	.pickable { cursor: pointer; outline: none; }
	.pickable:hover circle, .pickable:focus-visible circle { stroke-width: 3; fill: var(--panel); }
	.pickable.picked { cursor: default; }
	.pickable.picked circle { fill: var(--accent); }
	.pickable.picked text { fill: var(--on-accent); }
	.entity text { font: 500 11px var(--sans); fill: var(--text); text-anchor: middle; paint-order: stroke; stroke: var(--panel); stroke-width: 3px; }
	.entity path { stroke-width: 2; }
	.player path { fill: var(--accent); stroke: var(--accent); }
	.teammate path { fill: var(--panel); stroke: var(--accent); }
	.suspect path, .enemy path { fill: var(--bad-soft); stroke: var(--bad); }
	.civilian path { fill: var(--ok-soft); stroke: var(--ok); }
</style>
