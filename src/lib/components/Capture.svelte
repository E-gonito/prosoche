<script lang="ts">
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

<form onsubmit={submit}>
	<input bind:value={text} placeholder="Thought, link or task…" aria-label="Quick capture" disabled={saving} />
	<button class="btn primary" disabled={saving || !text.trim()}>{saving ? 'Saving…' : 'Add'}</button>
</form>
{#if note}<p class="hint">{note}</p>{:else}<p class="hint">Appends to Inbox/Capture.md under today's date. A line written as a task stays a task.</p>{/if}

<style>
	form { display: flex; gap: 8px; }
	input { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font: inherit; }
	input:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
</style>
