<script lang="ts">
	/**
	 * The command palette: ⌘K / Ctrl-K, one box, one list.
	 *
	 * All of the state is in `$lib/client/palette.svelte`, so this file only
	 * draws it and turns key presses into intent. It is mounted once in the
	 * app layout, which also makes it the one place that starts the global key
	 * listener — no other component binds to the window.
	 *
	 * Keyboard only, throughout: the arrows move, Enter chooses, Escape steps
	 * back and then closes, and focus returns to whatever had it before. A URL
	 * shared to the installed app arrives here too, as a capture waiting for
	 * Enter.
	 */
	import { page } from '$app/state';
	import { palette } from '$lib/client/palette.svelte';
	import { keyLabel } from '$lib/client/shortcuts.svelte';

	let box: HTMLInputElement | undefined = $state();
	let list: HTMLElement | undefined = $state();
	let returnTo: HTMLElement | null = null;

	// One listener for the whole app, started and stopped with this component.
	$effect(() => palette.install());

	// Focus follows the box while it is open, and goes back where it came from
	// when it closes, so the palette never strands the keyboard.
	$effect(() => {
		if (palette.open) {
			if (!returnTo) returnTo = document.activeElement as HTMLElement | null;
			box?.focus();
			box?.select();
		} else if (returnTo) {
			returnTo.focus?.();
			returnTo = null;
		}
	});

	// Keep the chosen row on screen when the arrows walk past the edge.
	$effect(() => {
		const index = palette.selected;
		list?.querySelectorAll('[data-testid="palette-row"]')[index]?.scrollIntoView({ block: 'nearest' });
	});

	/**
	 * A share from the phone's share sheet lands as query parameters. The
	 * palette opens with the shared text ready to capture, which is the whole
	 * of the share target: one Enter and it is in the inbox.
	 */
	$effect(() => {
		const params = page.url.searchParams;
		// The manifest's share target names its parameters `share_*`, so a
		// shared link can never be confused with a page's own query string.
		const shared = [params.get('share_title'), params.get('share_text'), params.get('share_url')]
			.filter(Boolean)
			.join(' ')
			.trim();
		if (!shared) return;
		palette.request({
			title: 'Capture what you shared',
			placeholder: 'Shared link…',
			submit: async (text) => {
				const { captureText } = await import('$lib/client/api');
				const result = await captureText(text);
				return result.ok ? `Saved to ${result.value.path}` : result.message;
			}
		});
		palette.askText = shared;
	});

	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			palette.back();
			return;
		}
		if (palette.ask) {
			if (event.key === 'Enter') {
				event.preventDefault();
				void palette.answer();
			}
			return;
		}
		if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
			event.preventDefault();
			palette.move(1);
		} else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
			event.preventDefault();
			palette.move(-1);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			palette.choose();
		}
	}

	/** Rows carry their own group, so the heading is drawn when it changes. */
	const heading = (index: number) =>
		index === 0 || palette.rows[index - 1].group !== palette.rows[index].group ? palette.rows[index].group : '';
</script>

{#if palette.open}
	<!-- The backdrop closes on click; it is not the only way out. -->
	<div
		class="scrim"
		data-testid="palette"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) palette.close();
		}}
	>
		<div class="panel" role="dialog" aria-modal="true" aria-label="Command palette">
			{#if palette.ask}
				<label class="ask" for="palette-input">{palette.ask.title}</label>
				<input
					id="palette-input"
					data-testid="palette-input"
					bind:this={box}
					bind:value={palette.askText}
					placeholder={palette.ask.placeholder}
					onkeydown={keydown}
					disabled={palette.busy}
					autocomplete="off"
				/>
				<p class="hint">Enter to save · Escape to go back</p>
			{:else}
				<input
					id="palette-input"
					data-testid="palette-input"
					bind:this={box}
					value={palette.query}
					oninput={(e) => palette.setQuery(e.currentTarget.value)}
					onkeydown={keydown}
					placeholder="Search notes, tasks, workspaces, or run a command…"
					aria-label="Command palette"
					aria-controls="palette-list"
					autocomplete="off"
				/>
				<div class="list" id="palette-list" role="listbox" aria-label="Results" bind:this={list}>
					{#each palette.rows as item, i (item.id)}
						{@const group = heading(i)}
						{#if group}<h6>{group}</h6>{/if}
						<button
							type="button"
							class="row"
							class:on={i === palette.selected}
							data-testid="palette-row"
							role="option"
							aria-selected={i === palette.selected}
							onmouseenter={() => (palette.selected = i)}
							onclick={() => {
								palette.selected = i;
								palette.choose();
							}}
						>
							<span class="title" data-testid="palette-title">
								{#each item.parts as part, p (p)}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
							</span>
							{#if item.hint}<span class="sub">{item.hint}</span>{/if}
							{#if item.keys}<kbd>{keyLabel(item.keys)}</kbd>{/if}
						</button>
					{:else}
						<p class="none">Nothing matched. Escape to close.</p>
					{/each}
				</div>
			{/if}

			{#if palette.message}<p class="said" data-testid="palette-message">{palette.message}</p>{/if}
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: rgba(31, 35, 40, 0.24);
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding: 10vh 16px 16px;
		z-index: 50;
	}
	.panel {
		width: min(620px, 100%);
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: 0 18px 48px rgba(31, 35, 40, 0.18);
		padding: 10px;
		max-height: 70vh;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	input {
		width: 100%;
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 10px 12px;
		font: inherit;
		font-size: 15px;
	}
	input:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
	.ask { display: block; font-size: 12px; color: var(--muted); margin: 2px 4px 6px; }
	.hint, .said { margin: 8px 4px 2px; font-size: 12px; color: var(--muted); }
	.list { margin-top: 8px; overflow: auto; min-height: 0; }
	h6 {
		margin: 10px 4px 4px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: var(--muted);
	}
	.row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0 10px;
		width: 100%;
		text-align: left;
		background: none;
		border: 0;
		border-radius: 8px;
		padding: 7px 10px;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.row.on { background: var(--accent-soft); }
	.title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.sub {
		grid-column: 1;
		font-size: 11px;
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	kbd {
		grid-row: 1 / 3;
		grid-column: 2;
		align-self: center;
		font: 11px var(--mono);
		color: var(--muted);
		border: 1px solid var(--line);
		border-bottom-width: 2px;
		border-radius: 5px;
		padding: 1px 6px;
	}
	mark { background: #fef08a; color: inherit; border-radius: 2px; }
	.none { margin: 12px 6px; color: var(--muted); font-size: 13px; }

	@media (max-width: 720px) {
		.scrim { padding: 6vh 8px 8px; }
		.panel { max-height: 84vh; }
	}
</style>
