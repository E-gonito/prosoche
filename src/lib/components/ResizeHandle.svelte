<script lang="ts">
	/**
	 * The divider between two panes.
	 *
	 * Reports pointer positions and key presses; the page turns those into
	 * widths, because only the page knows where its container edges are. It is
	 * a real `separator` with arrow-key support, so the layout can be adjusted
	 * without a mouse.
	 */
	let {
		label,
		value,
		min,
		max,
		onmove,
		onend,
		onnudge,
		ondoubleclick
	}: {
		label: string;
		value: number;
		min: number;
		max: number;
		onmove: (clientX: number) => void;
		onend?: () => void;
		onnudge: (delta: number) => void;
		ondoubleclick?: () => void;
	} = $props();

	let dragging = $state(false);
	const STEP = 16;

	function down(event: PointerEvent) {
		if (event.button !== 0) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		dragging = true;
	}

	function move(event: PointerEvent) {
		if (dragging) onmove(event.clientX);
	}

	function up() {
		if (!dragging) return;
		dragging = false;
		onend?.();
	}

	function key(event: KeyboardEvent) {
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			onnudge(-STEP);
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			onnudge(STEP);
		} else if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			ondoubleclick?.();
		}
	}
</script>

<!--
	A focusable `separator` with aria-valuenow is the ARIA window-splitter
	pattern, which makes this a widget rather than a decoration. The a11y rule
	does not model that case, so the two warnings it raises are wrong here.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="handle"
	class:dragging
	role="separator"
	aria-orientation="vertical"
	aria-label={label}
	aria-valuenow={value}
	aria-valuemin={min}
	aria-valuemax={max}
	tabindex="0"
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={up}
	ondblclick={() => ondoubleclick?.()}
	onkeydown={key}
></div>

<style>
	.handle {
		position: relative;
		width: 100%;
		height: 100%;
		cursor: col-resize;
		touch-action: none;
	}
	/* A wider invisible grab area than the visible line. */
	.handle::before {
		content: '';
		position: absolute;
		inset: 0 -4px;
	}
	.handle::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 50%;
		width: 1px;
		background: var(--line);
		transform: translateX(-50%);
	}
	.handle:hover::after,
	.handle:focus-visible::after,
	.handle.dragging::after { background: var(--accent); width: 2px; }
	.handle:focus-visible { outline: none; }
</style>
