<script lang="ts">
	/**
	 * A workspace's master note, `<home>/Overview.md`: read rendered, edited
	 * raw.
	 *
	 * Edit swaps the rendered note for a textarea holding the file exactly as
	 * it is on disk, frontmatter and all, and Save writes that text back whole
	 * with the hash it was opened with. It is the user's own text rather than
	 * something rebuilt from a model, which is why a whole-file write is
	 * allowed here. A save that meets a newer version writes nothing and says
	 * so, keeping what was typed; a missing note offers to be written, and the
	 * first save creates it.
	 */
	import { invalidateAll } from '$app/navigation';
	import { saveNote } from '$lib/client/api';

	let {
		path,
		exists,
		raw,
		hash,
		html
	}: { path: string; exists: boolean; raw: string; hash: string; html: string } = $props();

	let editing = $state(false);
	let text = $state('');
	let saving = $state(false);
	let problem = $state('');
	/** The hash the editor was opened with, so a reload underneath is noticed. */
	let openedWith = $state('');

	function edit() {
		text = raw;
		openedWith = hash;
		problem = '';
		editing = true;
	}

	async function save() {
		saving = true;
		problem = '';
		const result = await saveNote(path, text, openedWith);
		saving = false;
		if (result.ok) {
			editing = false;
			await invalidateAll();
			return;
		}
		problem =
			result.kind === 'conflict'
				? `${path} changed somewhere else since you opened it, so nothing was saved. Copy your text, then Cancel to see the new version.`
				: result.message;
	}

	async function cancel() {
		editing = false;
		problem = '';
		await invalidateAll();
	}

	const focus = (el: HTMLElement) => el.focus();
</script>

<div class="master" data-testid="master-note">
	{#if editing}
		<textarea
			class="field"
			data-testid="master-note-text"
			aria-label="Overview.md"
			bind:value={text}
			use:focus
			rows="14"
			spellcheck="true"
			onkeydown={(e) => {
				if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
					e.preventDefault();
					void save();
				}
			}}
		></textarea>
		{#if problem}<p class="problem" role="alert" data-testid="master-note-problem">{problem}</p>{/if}
		<div class="actions">
			<button class="btn primary" data-testid="master-note-save" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
			<button class="btn ghost" data-testid="master-note-cancel" onclick={cancel} disabled={saving}>Cancel</button>
			<code class="path">{path}</code>
		</div>
	{:else if html}
		<div class="prose">{@html html}</div>
		<button class="btn small" data-testid="master-note-edit" onclick={edit}>Edit</button>
	{:else}
		<p class="none">{exists ? `${path} is empty.` : 'No overview yet: what this workspace is for, who is involved, what matters now.'}</p>
		<button class="btn small" data-testid="master-note-edit" onclick={edit}>Write an overview</button>
	{/if}
</div>

<style>
	.master { display: flex; flex-direction: column; align-items: flex-start; gap: var(--s3); }
	.prose { max-width: var(--read-w); width: 100%; }
	.prose :global(> :first-child) { margin-top: 0; }
	textarea { font: var(--t14)/1.6 var(--mono); min-height: 280px; }
	.actions { display: flex; align-items: center; gap: var(--s2); width: 100%; }
	.path { margin-left: auto; font: var(--t11) var(--mono); color: var(--muted); }
	.problem { margin: 0; }
</style>
