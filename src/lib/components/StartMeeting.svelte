<script lang="ts">
	/**
	 * "Start a meeting" from a workspace's Overview. (A glossary's page only
	 * links to the notebooks of the workspaces pointing at it.)
	 *
	 * The button goes to the workspace's meeting notes, where the title is
	 * typed and Start meeting or Start standup pressed, rather than starting
	 * a note called "Meeting" nobody named. A workspace without meetings is
	 * given a notebook first (its definition gains `meetings: true`), so the
	 * button never leads to a 404. Emits nothing; its one effect is that
	 * write and the navigation.
	 */
	import { goto } from '$app/navigation';
	import { meetingAction } from '$lib/client/meetings';

	let { slug, meetings, small = false }: { slug: string; meetings: boolean; small?: boolean } = $props();

	let busy = $state(false);
	let problem = $state('');

	async function start() {
		problem = '';
		if (!meetings) {
			busy = true;
			const result = await meetingAction({ action: 'enable', slug });
			busy = false;
			if (!result.ok) {
				problem = result.message;
				return;
			}
		}
		await goto(`/meetings/${slug}/notes`, { invalidateAll: true });
	}
</script>

<button class="btn" class:small class:primary={!small} disabled={busy} onclick={start} data-testid="start-a-meeting">
	{busy ? 'Setting up…' : 'Start a meeting'}
</button>
{#if problem}<span class="problem" role="status">{problem}</span>{/if}

<style>
	.problem { color: var(--bad); font-size: var(--t13); margin-left: var(--s2); }
</style>
