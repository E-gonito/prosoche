<script lang="ts">
	/**
	 * One line into the inbox, from wherever the day is being looked at.
	 *
	 * Shaped as a row rather than as a card: it lives at the top of the
	 * Unscheduled list, because "something I have not done yet" and "something
	 * I have just thought of" are the same thought half a second apart. The
	 * text goes to `Inbox/Capture.md` under today's date, never into the note
	 * on screen, and the confirmation says which file took it.
	 */
	import { captureText } from '$lib/client/api';
	let { onproblem }: { onproblem?: (message: string) => void } = $props();

	let text = $state('');
	let saving = $state(false);
	let note = $state('');

	async function submit(event: Event) {
		event.preventDefault();
		const value = text.trim();
		if (!value || saving) return;
		saving = true;
		const result = await captureText(value);
		saving = false;
		if (result.ok) {
			text = '';
			note = `Saved to ${result.value.path}`;
			setTimeout(() => (note = ''), 4000);
		} else {
			onproblem?.(result.message);
		}
	}
</script>

<form class="row" data-testid="capture-row" onsubmit={submit}>
	<input
		bind:value={text}
		placeholder="Capture a thought or a task…"
		aria-label="Quick capture"
		title="Appends to Inbox/Capture.md under today's date"
		disabled={saving}
	/>
	<button class="btn primary add" disabled={saving || !text.trim()}>{saving ? 'Saving…' : 'Add'}</button>
</form>
{#if note}<p class="hint">{note}</p>{/if}

<style>
	/* The padding a task row uses, so this reads as the first line of the list. */
	.row { display: flex; gap: var(--s2); padding: var(--s1) var(--s1) var(--s2); }
	input { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: var(--r-md); padding: 7px 10px; font: inherit; background: var(--field); }
	input:focus-visible { outline: var(--focus); outline-offset: -1px; }
	.add { flex: none; padding: 6px 10px; }
	.hint { margin: 0 0 6px; }
</style>
