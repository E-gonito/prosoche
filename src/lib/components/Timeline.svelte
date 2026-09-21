<script lang="ts">
	/**
	 * The day as a vertical timeline.
	 *
	 * Dragging a block changes the `HH:MM - HH:MM` prefix on its line and
	 * nothing else. It never reorders the file, so a block dragged past another
	 * stays where it was written. Dragging snaps to ten minutes, matching the
	 * vault's Day Planner setting.
	 */
	import { layoutBlocks, snap, timelineRange } from '$lib/shared/layout';
	import { formatMinutes } from '$lib/shared/time';
	import { editTask } from '$lib/client/api';
	import { displayText, isDone, type Task } from '$lib/shared/task';
	import { drag as listDrag, registerDropZone, zoneAt } from '$lib/client/drag.svelte';
	import { timer } from '$lib/client/timer.svelte';

	let {
		tasks,
		isToday = false,
		onchange,
		onproblem
	}: {
		tasks: Task[];
		isToday?: boolean;
		onchange?: (task: Task) => void;
		onproblem?: (message: string) => void;
	} = $props();

	/**
	 * The scale, and the rule that sets it: **the shortest block this app lets
	 * you make must be legible.** `SNAP` and `MIN_DURATION` are both ten
	 * minutes, so ten minutes has to be tall enough for one row of text —
	 * about eighteen pixels once padding and border are counted. At one pixel
	 * per minute it was ten, so every short block was forced up to a minimum
	 * height, and adjacent ones then overlapped and sliced each other's text
	 * in half. Two pixels per minute makes the height honest, which means no
	 * minimum is needed and nothing occludes anything.
	 *
	 * The cost is a longer page. That is the right trade for a day with a
	 * column of ten-minute tasks in it, which is what these days look like.
	 */
	const PX_PER_MIN = 2;
	const SNAP = 10;
	const MIN_DURATION = 10;
	/** Gap between one block and the next, taken out of the block's height. */
	const BLOCK_GAP = 2;
	/**
	 * The label's line height, and everything above it, so a block can work
	 * out how many lines of label it has room for. These match the stylesheet
	 * below and are the whole of the arithmetic in `labelLines`.
	 */
	const LABEL_LINE_PX = 18;
	const BLOCK_CHROME_PX = 10 + 2 + 15; // padding, border, the line of time.
	/**
	 * Below this height, a block puts its time and label on one line.
	 *
	 * The number is what the two-line layout actually needs: 10px of padding,
	 * 2px of border, a 14px line of time and an 18px line of label. A block
	 * between the two would clip its own second line, so the threshold is the
	 * requirement rather than a guess. Compact loses nothing — it shows the
	 * same time and the same label, side by side.
	 */
	const COMPACT_BELOW_PX = 44;

	type Drag = {
		task: Task;
		mode: 'move' | 'resize';
		fromY: number;
		origStart: number;
		origEnd: number;
		startMin: number;
		endMin: number;
		/** Set when the pointer has left the timeline for a list. */
		leaving: string | null;
	};
	let drag = $state<Drag | null>(null);
	let busy = $state<Set<number>>(new Set());

	// Finite check as well as null: a task arriving without usable numbers used
	// to make the whole timeline collapse, which is a bad way to find out.
	const scheduled = $derived(
		tasks.filter((t) => Number.isFinite(t.startMin) && Number.isFinite(t.endMin))
	);

	/** The range each block occupies, with the dragged one showing its preview. */
	function rangeOf(task: Task): { startMin: number; endMin: number } {
		if (drag && drag.task.line === task.line && drag.task.path === task.path) {
			return { startMin: drag.startMin, endMin: drag.endMin };
		}
		return { startMin: task.startMin!, endMin: task.endMin! };
	}

	const range = $derived(timelineRange(scheduled.map(rangeOf)));
	const placed = $derived(layoutBlocks(scheduled, rangeOf));
	const hours = $derived(
		Array.from({ length: Math.ceil((range.toMin - range.fromMin) / 60) + 1 }, (_, i) => range.fromMin + i * 60)
	);
	const heightPx = $derived((range.toMin - range.fromMin) * PX_PER_MIN);

	let grid: HTMLDivElement | undefined = $state();
	let dropping = $state(false);

	/** Register as the drop target for tasks dragged in from a list. */
	$effect(() => {
		if (!grid) return;
		const element = grid;
		return registerDropZone({
			id: 'timeline',
			element,
			minuteAt: (clientY) => {
				const rect = element.getBoundingClientRect();
				const minute = range.fromMin + (clientY - rect.top) / PX_PER_MIN;
				return Math.max(range.fromMin, Math.min(range.toMin - MIN_DURATION, snap(minute, SNAP)));
			},
			drop: (task, startMin) => void schedule(task, startMin ?? range.fromMin)
		});
	});

	/** Give a dragged-in task a time. Defaults to a 30 minute block. */
	async function schedule(task: Task, startMin: number) {
		dropping = true;
		const result = await editTask(task, {
			time: { start: formatMinutes(startMin), end: formatMinutes(Math.min(1440, startMin + 30)) }
		});
		dropping = false;
		if (result.ok) onchange?.(result.value);
		else onproblem?.(result.message);
	}

	let nowMin = $state(currentMinutes());
	$effect(() => {
		if (!isToday) return;
		const timer = setInterval(() => (nowMin = currentMinutes()), 60_000);
		return () => clearInterval(timer);
	});

	/**
	 * How many lines of label fit in a block of this height.
	 *
	 * A long task name wraps, and a wrapped line that does not fit was being
	 * sliced in half by the block's own `overflow: hidden`. Clamping to the
	 * lines that fit turns that into an ellipsis, which reads as "there is
	 * more" rather than as a rendering fault. Never returns zero: a block
	 * always shows at least the start of its name.
	 */
	function labelLines(heightPx: number): number {
		return Math.max(1, Math.floor((heightPx - BLOCK_CHROME_PX) / LABEL_LINE_PX));
	}

	function currentMinutes(): number {
		const d = new Date();
		return d.getHours() * 60 + d.getMinutes();
	}

	function top(minutes: number): number {
		return (minutes - range.fromMin) * PX_PER_MIN;
	}

	function start(event: PointerEvent, task: Task, mode: 'move' | 'resize') {
		if (event.button !== 0) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		drag = {
			task,
			mode,
			fromY: event.clientY,
			origStart: task.startMin!,
			origEnd: task.endMin!,
			startMin: task.startMin!,
			endMin: task.endMin!,
			leaving: null
		};
	}

	function move(event: PointerEvent) {
		if (!drag) return;

		// Dragging a block onto one of the lists means "take the time off it".
		if (drag.mode === 'move') {
			const zone = zoneAt(event.clientX, event.clientY);
			const leaving = zone && zone.id !== 'timeline' && !zone.minuteAt ? zone.id : null;
			if (leaving !== drag.leaving) drag = { ...drag, leaving };
			if (leaving) return;
		}

		const deltaMin = (event.clientY - drag.fromY) / PX_PER_MIN;
		if (drag.mode === 'move') {
			const duration = drag.origEnd - drag.origStart;
			const startMin = clamp(snap(drag.origStart + deltaMin, SNAP), 0, 1440 - duration);
			drag = { ...drag, startMin, endMin: startMin + duration };
		} else {
			const endMin = clamp(snap(drag.origEnd + deltaMin, SNAP), drag.origStart + MIN_DURATION, 1440);
			drag = { ...drag, startMin: drag.origStart, endMin };
		}
	}

	async function finish() {
		const current = drag;
		drag = null;
		if (!current) return;

		const unschedule = current.leaving !== null;
		if (!unschedule && current.startMin === current.origStart && current.endMin === current.origEnd) return;

		busy = new Set(busy).add(current.task.line);
		const result = await editTask(
			current.task,
			unschedule
				? { time: null }
				: { time: { start: formatMinutes(current.startMin), end: formatMinutes(current.endMin) } }
		);
		const next = new Set(busy);
		next.delete(current.task.line);
		busy = next;

		if (result.ok) onchange?.(result.value);
		else onproblem?.(result.message);
	}

	/** Take the time off a block, leaving it in the note as an unscheduled task. */
	async function unschedule(task: Task) {
		busy = new Set(busy).add(task.line);
		const result = await editTask(task, { time: null });
		const next = new Set(busy);
		next.delete(task.line);
		busy = next;
		if (result.ok) onchange?.(result.value);
		else onproblem?.(result.message);
	}

	/**
	 * Keyboard equivalent, so the timeline is usable without a pointer.
	 *
	 * Nudges are chained per task. Each edit carries the line as the client
	 * last saw it, so firing two in parallel means the second sends a line the
	 * server has already replaced and is refused. Holding an arrow key should
	 * move a block repeatedly, not once.
	 */
	const nudging = new Map<string, Promise<Task | null>>();

	function nudge(task: Task, minutes: number) {
		const key = `${task.path}:${task.line}`;
		const previous = nudging.get(key) ?? Promise.resolve(task);
		const next = previous.then(async (latest) => {
			const base = latest ?? task;
			if (base.startMin === null || base.endMin === null) return base;
			const duration = base.endMin - base.startMin;
			const startMin = clamp(base.startMin + minutes, 0, 1440 - duration);
			const result = await editTask(base, {
				time: { start: formatMinutes(startMin), end: formatMinutes(startMin + duration) }
			});
			if (!result.ok) {
				onproblem?.(result.message);
				return base;
			}
			onchange?.(result.value);
			return result.value;
		});
		nudging.set(key, next);
		void next.finally(() => {
			if (nudging.get(key) === next) nudging.delete(key);
		});
	}

	function clamp(value: number, low: number, high: number): number {
		return Math.max(low, Math.min(high, value));
	}

	const dragging = $derived(drag !== null);
</script>

<div class="wrap">
	<div
		class="timeline"
		data-testid="timeline"
		class:dragging
		class:receiving={listDrag.task !== null}
		class:dropping
		bind:this={grid}
		style="height: {heightPx}px"
	>
		{#each hours as hour (hour)}
			<div class="hour" style="top: {top(hour)}px"><span>{formatMinutes(hour)}</span></div>
		{/each}

		{#if listDrag.task && listDrag.over !== null}
			<div class="drop" style="top: {top(listDrag.over)}px; height: {30 * PX_PER_MIN}px">
				{formatMinutes(listDrag.over)} · {displayText(listDrag.task.text)}
			</div>
		{/if}

		{#if scheduled.length === 0}
			<p class="vacant">
				{listDrag.task ? 'Drop to schedule it here' : 'Nothing time-blocked on this day.'}
			</p>
		{/if}

		{#if isToday && nowMin >= range.fromMin && nowMin <= range.toMin}
			<div class="now" style="top: {top(nowMin)}px"></div>
		{/if}

		{#each placed as p (p.item.path + ':' + p.item.line)}
			{@const task = p.item}
			{@const done = isDone(task)}
			{@const timing = timer.task?.path === task.path && timer.task?.line === task.line}
			<div
				class="block q{task.quadrant ?? 0}"
				data-testid="block"
				data-line={task.line}
				data-start={p.startMin}
				data-end={p.endMin}
				class:done
				class:busy={busy.has(task.line)}
				class:active={drag?.task.line === task.line}
				class:compact={(p.endMin - p.startMin) * PX_PER_MIN < COMPACT_BELOW_PX}
				class:leaving={drag?.task.line === task.line && drag?.leaving !== null}
				style="top: {top(p.startMin)}px; height: {(p.endMin - p.startMin) * PX_PER_MIN - BLOCK_GAP}px;
				       --label-lines: {labelLines((p.endMin - p.startMin) * PX_PER_MIN - BLOCK_GAP)};
				       left: calc(54px + {(p.column / p.columns) * 100}% - {(p.column / p.columns) * 58}px);
				       width: calc({100 / p.columns}% - {58 / p.columns}px - 4px)"
				role="button"
				tabindex="0"
				aria-label="{task.text}, {formatMinutes(p.startMin)} to {formatMinutes(p.endMin)}"
				onpointerdown={(e) => start(e, task, 'move')}
				onpointermove={move}
				onpointerup={finish}
				onpointercancel={finish}
				onkeydown={(e) => {
					if (e.key === 'ArrowUp') { e.preventDefault(); nudge(task, -SNAP); }
					if (e.key === 'ArrowDown') { e.preventDefault(); nudge(task, SNAP); }
					if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); void unschedule(task); }
				}}
			>
				<div class="t">{formatMinutes(p.startMin)}–{formatMinutes(p.endMin)}</div>
				<div class="label">{displayText(task.text)}</div>
				{#if task.quadrant}<span class="q q{task.quadrant} badge">Q{task.quadrant}</span>{/if}
				{#if !done}
					<button
						class="run"
						class:timing
						data-testid="block-timer"
						title={timing ? 'Stop and log the time' : 'Start timing this block'}
						aria-pressed={timing}
						aria-label={timing
							? `Stop timing "${displayText(task.text)}"`
							: `Start timing "${displayText(task.text)}"`}
						onpointerdown={(e) => e.stopPropagation()}
						onclick={(e) => {
							e.stopPropagation();
							void (timing ? timer.stop() : timer.start(task.path, task.line));
						}}
					>{timing ? '\u25A0' : '\u25B6'}</button>
				{/if}
				<button
					class="clear"
					data-testid="clear-time"
					title="Remove the time, leaving it as an unscheduled task"
					aria-label="Unschedule {displayText(task.text)}"
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => { e.stopPropagation(); void unschedule(task); }}
				>✕</button>
				<div
					class="handle"
					data-testid="resize"
					role="button"
					tabindex="-1"
					aria-label="Resize {task.text}"
					onpointerdown={(e) => { e.stopPropagation(); start(e, task, 'resize'); }}
					onpointermove={move}
					onpointerup={finish}
				></div>
			</div>
		{/each}
	</div>
	<p class="hint">
		Drag a block to move it, its bottom edge to resize, or focus one and use the arrow keys. Drag the ⠿ grip beside
		an unscheduled task to give it a time, and drag a block out onto the Unscheduled list, press its ✕, or press
		Backspace on it, to take the time off again. Snaps to {SNAP} minutes. Only the time on that line changes; the
		note keeps its own order.
	</p>
</div>

<style>
	.timeline {
		position: relative;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--r);
		overflow: hidden;
		touch-action: none;
	}
	.dragging { cursor: grabbing; user-select: none; }
	.receiving { outline: 2px dashed var(--accent); outline-offset: -2px; }
	.dropping { opacity: 0.7; }

	.drop {
		position: absolute;
		left: 54px;
		right: 8px;
		border-radius: 8px;
		border: 2px dashed var(--accent);
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 12px;
		padding: 4px 8px;
		pointer-events: none;
		z-index: 5;
		overflow: hidden;
		white-space: nowrap;
	}
	.vacant {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		margin: 0;
		color: var(--muted);
		font-size: 13px;
		pointer-events: none;
	}

	.hour {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px solid var(--line);
		font: 11px var(--mono);
		color: var(--muted);
		pointer-events: none;
	}
	.hour span { position: relative; top: -7px; left: 8px; background: var(--panel); padding-right: 6px; }

	.now { position: absolute; left: 46px; right: 0; border-top: 2px solid #ef4444; pointer-events: none; z-index: 3; }
	.now::before {
		content: '';
		position: absolute;
		left: -6px;
		top: -5px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #ef4444;
	}

	.block {
		position: absolute;
		border-radius: 8px;
		padding: 5px 9px;
		background: #fff;
		border: 1px solid var(--line);
		border-left: 4px solid var(--muted);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
		font-size: 13px;
		cursor: grab;
		overflow: hidden;
		z-index: 2;
	}
	.block:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
	.block.active { z-index: 4; box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18); cursor: grabbing; }
	.block.busy { opacity: 0.55; }
	.block.done { opacity: 0.6; }
	.block.done .label { text-decoration: line-through; }
	.block.q1 { border-left-color: var(--q1); }
	.block.q2 { border-left-color: var(--q2); }
	.block.q3 { border-left-color: var(--q3); }
	.block.q4 { border-left-color: var(--q4); }

	.t { font: 11px var(--mono); line-height: 15px; color: var(--muted); }
	/*
	 * Clamped to the lines the block has room for, computed from its height.
	 * Without this a long name wrapped past the bottom edge and was sliced in
	 * half by `overflow: hidden`, which looks like a bug rather than like text
	 * continuing.
	 */
	.label {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: var(--label-lines, 2);
		line-clamp: var(--label-lines, 2);
		line-height: 18px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Clear of the ✕ button, which appears in the same corner on hover. */
	.badge { position: absolute; top: 5px; right: 26px; }

	/*
	 * A ten-minute block is eighteen pixels tall, so the compact row is built
	 * to that budget: sixteen pixels inside the border, holding a 12px label
	 * at line-height 1.2, centred. No vertical padding, because there is none
	 * to spare — the block clips, and a row that does not fit is the bug this
	 * was written to remove.
	 */
	.block.compact {
		display: flex;
		align-items: center;
		gap: 8px;
		/* The right padding is the room the ▶ and ✕ occupy on hover. They are
		   absolutely positioned, so only this keeps the text from running
		   underneath them. The taller blocks reserve it on the badge instead. */
		padding: 0 44px 0 9px;
		white-space: nowrap;
		line-height: 1.2;
	}
	.block.compact .t { flex: none; }
	/* Sized to its content but allowed to shrink, which keeps the badge next
	   to the text rather than out at the edge. `min-width: 0` is what lets the
	   ellipsis happen at all: without it a flex child will not shrink below
	   its content, so a long label overflowed instead of truncating. */
	.block.compact .label {
		display: block;
		flex: 0 1 auto;
		min-width: 0;
		font-size: 12px;
		line-height: inherit;
	}
	.block.compact .badge { position: static; flex: none; }

	.handle { position: absolute; left: 0; right: 0; bottom: 0; height: 7px; cursor: ns-resize; }

	.block.leaving { opacity: 0.35; border-style: dashed; }

	.clear {
		position: absolute;
		top: 3px;
		right: 3px;
		width: 18px;
		height: 18px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--muted);
		font-size: 11px;
		line-height: 1;
		cursor: pointer;
		opacity: 0;
	}
	.block:hover .clear,
	.block:focus-within .clear { opacity: 1; }
	.clear:hover { background: var(--soft); color: var(--bad); }
	.block.compact .clear { top: 50%; right: 2px; width: 16px; height: 16px; transform: translateY(-50%); }

	/* Sits beside the ✕, and stays visible while this block is the one running. */
	.run {
		position: absolute;
		top: 3px;
		right: 23px;
		width: 18px;
		height: 18px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--muted);
		font-size: 10px;
		line-height: 1;
		cursor: pointer;
		opacity: 0;
	}
	.block:hover .run,
	.block:focus-within .run,
	.run.timing { opacity: 1; }
	.run:hover { background: var(--soft); color: var(--accent); }
	.run.timing { color: var(--q1); }
	.block.compact .run { top: 50%; right: 20px; width: 16px; height: 16px; transform: translateY(-50%); }
</style>
