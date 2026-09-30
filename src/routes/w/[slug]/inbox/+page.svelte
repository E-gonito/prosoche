<script lang="ts">
	/**
	 * A workspace's inbox: the lines of `Inbox/Capture.md` that carry its tag
	 * or an alias, with the same three exits as the triage page, and `b`
	 * filing straight to this workspace's board. The capture box here writes
	 * the same file with the workspace's tag appended.
	 *
	 * An old `<home>/Inbox.md` is no longer written; its open lines are
	 * listed read-only below until they are dealt with in Obsidian.
	 */
	import { invalidateAll } from '$app/navigation';
	import Capture from '$lib/components/Capture.svelte';
	import InboxRows from '$lib/components/InboxRows.svelte';
	import { noteHref } from '$lib/shared/links';
	import { displayText } from '$lib/shared/task';

	let { data } = $props();
	let problem = $state('');
</script>

<p class="label">Capture</p>
<Capture workspace={data.workspace.slug} oncaptured={() => invalidateAll()} onproblem={(m) => (problem = m)} />

{#if problem}<p class="problem">{problem}</p>{/if}

<p class="label">Inbox <span class="right"><span class="num">{data.inbox.lines.length}</span> open · <a href="/inbox">All captures</a></span></p>
<InboxRows
	lines={data.inbox.lines}
	workspaces={[data.workspace]}
	fileTo={data.workspace.slug}
	onproblem={(m) => (problem = m)}
/>

{#if data.inbox.legacy.lines.length}
	<p class="label">Older, read-only <span class="right"><a href={noteHref(data.inbox.legacy.path)}><code>{data.inbox.legacy.path}</code></a></span></p>
	<div class="sheet rows" data-testid="legacy-inbox">
		{#each data.inbox.legacy.lines as line (line.line)}
			<p class="legacy">{displayText(line.text)}</p>
		{/each}
	</div>
	<p class="hint">Nothing writes this file any more. Tick or move these lines in Obsidian.</p>
{/if}

<style>
	.legacy { margin: 0; font-size: var(--t14); }
</style>
