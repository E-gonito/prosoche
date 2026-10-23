<script lang="ts">
	/**
	 * The now strip: one line about what is running, due or about to start.
	 *
	 * It draws what `stripView` says for the strip the layout loaded and the
	 * clock `now` keeps (the server's, ticking); it decides nothing itself. The
	 * whole line is a link (to `/focus` while running, to the block's start page
	 * or, for a same-start group, to Today); a due strip adds a Start button.
	 * With no strip it draws nothing, not an empty box. `variant` is only the
	 * shape: `rail` is a card at the top of the desktop rail, `bar` a slim line
	 * with a 44px touch target under the phone header. The layout draws both and
	 * hides one by width, so this holds no timers; `now` does.
	 */
	import { now } from '$lib/client/now.svelte';
	import { stripView, type NowStrip } from '$lib/shared/focus-now';

	let { strip, variant }: { strip: NowStrip | null; variant: 'rail' | 'bar' } = $props();

	// Before the clock first ticks (server render, first paint) the data's own instant is used, so both agree.
	const view = $derived(strip ? stripView(strip, now.at || strip.serverNow) : null);
</script>

{#if view}
	<div class="strip {variant} {view.state}" data-testid="now-strip" data-state={view.state} data-variant={variant}>
		<a class="line" href={view.href} data-testid="now-link">
			<i class="dot" aria-hidden="true"></i>
			<span class="label">{view.label}</span>
			{#if view.detail}<span class="sep" aria-hidden="true">·</span><span class="detail num" class:over={view.over}>{view.detail}</span>{/if}
		</a>
		{#if view.start}<a class="btn small primary go" href={view.start} data-testid="now-start">Start</a>{/if}
	</div>
{/if}

<style>
	.strip {
		display: flex;
		align-items: center;
		gap: var(--s2);
		color: var(--text);
		font-size: var(--t13);
	}
	.line {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		min-width: 0;
		/* The smallest target a thumb reliably hits. */
		min-height: 44px;
		color: inherit;
	}
	.line:hover { text-decoration: none; }
	.label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
	.sep { color: var(--muted); flex: none; }
	.detail { flex: none; color: var(--muted); }
	.detail.over { color: var(--warn); font-weight: 600; }
	.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
	/* Soon is quiet: an empty ring, muted words. */
	.soon .dot { background: none; box-shadow: inset 0 0 0 1.5px var(--muted); }
	.soon .label { color: var(--muted); font-weight: 500; }
	.go { flex: none; min-height: 32px; display: inline-flex; align-items: center; }

	/* The rail's card. Due is the one that asks for something, so it takes the accent. */
	.rail {
		margin-bottom: var(--s3);
		padding: 0 var(--s2) 0 10px;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--panel);
	}
	.rail .line { min-height: 36px; }
	.rail.due { background: var(--accent-soft); border-color: var(--accent); }
	.rail.running { background: var(--soft); }

	/* The phone's slim line, inside the sticky header. */
	.bar { padding: 0 var(--s4); border-top: 1px solid var(--line); }
	.bar.due { background: var(--accent-soft); }
	.bar.running { background: var(--soft); }
</style>
