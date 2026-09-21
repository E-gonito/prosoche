<script lang="ts">
	/**
	 * The running timer, in the header of every page.
	 *
	 * Shows nothing at all when nothing is running, so the header is not cluttered
	 * by a control for something that is not happening. While a timer runs it
	 * shows the elapsed time, what is being timed and a stop button; on a phone
	 * the task name gives way first, because the count and the stop button are
	 * what the thumb needs.
	 */
	import { timer } from '$lib/client/timer.svelte';

	$effect(() => timer.attach());
</script>

{#if timer.running}
	<div class="timer" data-testid="timer" title="Timing {timer.task?.text}">
		<span class="dot" aria-hidden="true"></span>
		<span class="elapsed" data-testid="timer-elapsed">{timer.elapsed}</span>
		<span class="what" data-testid="timer-task">{timer.task?.text}</span>
		<button
			class="stop"
			data-testid="timer-stop"
			onclick={() => timer.stop()}
			disabled={timer.busy}
			aria-label="Stop timing {timer.task?.text}"
		>Stop</button>
	</div>
{:else if timer.confirmation}
	<span class="logged" data-testid="timer-logged">{timer.confirmation}</span>
{/if}

<style>
	.timer {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		max-width: 38vw;
		padding: 3px 4px 3px 10px;
		border: 1px solid var(--accent);
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
	}
	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
		animation: pulse 2s ease-in-out infinite;
	}
	.elapsed {
		flex: none;
		font: 13px var(--mono);
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.what {
		min-width: 0;
		font-size: 13px;
		color: var(--text);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.stop {
		flex: none;
		border: 0;
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font: inherit;
		font-size: 12px;
		padding: 3px 11px;
		cursor: pointer;
	}
	.stop:hover { filter: brightness(1.08); }
	.stop:disabled { opacity: 0.6; cursor: default; }
	.logged { font-size: 12px; color: var(--ok); }

	@keyframes pulse {
		50% { opacity: 0.35; }
	}
	@media (prefers-reduced-motion: reduce) {
		.dot { animation: none; }
	}

	/* On a phone the name of the task is the first thing to go: the count and
	   the stop button have to stay reachable. */
	@media (max-width: 720px) {
		.timer { max-width: 50vw; }
		.what { display: none; }
	}
</style>
