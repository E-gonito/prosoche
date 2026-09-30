<script lang="ts">
	/**
	 * One line into the vault, from wherever the day is being looked at.
	 *
	 * Shaped as a row rather than as a card: it lives at the top of the
	 * Unscheduled list, because "something I have not done yet" and "something
	 * I have just thought of" are the same thought half a second apart. The
	 * server decides where the line goes from its words (a time range to
	 * today's note, a workspace's tag or alias to its board, else
	 * `Inbox/Capture.md`), and the confirmation is its sentence saying where.
	 */
	import { api } from '$lib/client/api';
	let {
		onproblem,
		oncaptured,
		workspace
	}: {
		onproblem?: (message: string) => void;
		/** Called once the line is written, for a page that lists where it went. */
		oncaptured?: () => void;
		/** Given, the line goes to the inbox tagged for that workspace. */
		workspace?: string;
	} = $props();

	let text = $state('');
	let saving = $state(false);
	let note = $state('');

	async function submit(event: Event) {
		event.preventDefault();
		const value = text.trim();
		if (!value || saving) return;
		saving = true;
		const result = await api<{ message: string }>('/api/capture', { text: value, workspace });
		saving = false;
		if (result.ok) {
			text = '';
			note = result.value.message;
			oncaptured?.();
			setTimeout(() => (note = ''), 4000);
		} else {
			onproblem?.(result.message);
		}
	}
</script>

<form class="add-row row" data-testid="capture-row" onsubmit={submit}>
	<input
		class="field"
		bind:value={text}
		placeholder="Capture a thought or a task…"
		aria-label="Quick capture"
		title="A time range goes to today, #ws/name or a workspace's name to its board, anything else to the inbox"
		disabled={saving}
	/>
	<button class="btn primary add" disabled={saving || !text.trim()}>{saving ? 'Saving…' : 'Add'}</button>
</form>
{#if note}<p class="hint">{note}</p>{/if}

<style>
	/* The padding a task row uses, so this reads as the first line of the list. */
	.row { padding: var(--s1) var(--s1) var(--s2); }
	.add { flex: none; padding: 6px 10px; }
	.hint { margin: 0 0 6px; }
</style>
