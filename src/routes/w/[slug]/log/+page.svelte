<script lang="ts">
	/**
	 * A workspace's dated log: one `## day` section per session, newest shown
	 * first. The file itself keeps whatever order it was written in; only the
	 * display is reversed.
	 */
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let text = $state('');
	let saving = $state(false);
	let problem = $state('');

	async function add(event: Event) {
		event.preventDefault();
		const value = text.trim();
		if (!value || saving) return;
		saving = true;
		const res = await fetch('/api/log', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ workspace: data.workspace.slug, text: value })
		});
		const body = await res.json().catch(() => ({}));
		saving = false;
		if (!res.ok) {
			problem = body.error ?? 'Could not save that.';
			return;
		}
		problem = '';
		text = '';
		await invalidateAll();
	}
</script>

<p class="label">Add an update</p>
<form class="add" onsubmit={add}>
	<input bind:value={text} placeholder="What happened in this session?" aria-label="Log update" data-testid="log-text" />
	<button class="btn primary" disabled={saving || !text.trim()} data-testid="log-add">{saving ? 'Saving…' : 'Add'}</button>
</form>
{#if problem}<p class="problem">{problem}</p>{/if}

<p class="label">Sessions</p>
{#each data.entries as entry (entry.day)}
	<div class="sheet rows entry" data-testid="log-entry">
		<p class="day">{entry.day}</p>
		{#each entry.lines as line (line)}
			<p class="line">{line.replace(/^[ \t]*[-*+][ \t]+/, '')}</p>
		{/each}
	</div>
{:else}
	<p class="none">No sessions logged yet.</p>
{/each}

<style>
	.add { display: flex; gap: var(--s2); margin-bottom: var(--s2); }
	.add input { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: var(--r-md); padding: 7px 10px; font: inherit; background: var(--field); }
	.problem { font-size: var(--t12); color: var(--bad); }
	.entry { margin-bottom: var(--s3); }
	.day { margin: 0; padding: var(--s2); font: 600 var(--t13) inherit; }
	.line { margin: 0; padding: var(--s1) var(--s2); border-top: 1px solid var(--line); font-size: var(--t13); }
</style>
