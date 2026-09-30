<script lang="ts" module>
	/** What a list says about one item, and what its Edit form can change. */
	export interface Details {
		name: string;
		/** One line: the paragraph under the title of the item's own file. */
		description: string;
		/** `#rrggbb`, drawn as the dot before the name. */
		color?: string;
		/** The tag that claims notes for it, without the `#`. */
		tag?: string;
	}

	export type DetailField = keyof Details;
</script>

<script lang="ts">
	/**
	 * Edit and Delete for one item on a list page — a workspace, a study
	 * subject, a glossary — the same wherever it appears, so every module's
	 * list edits its items one way. The item's own page only shows them.
	 *
	 * Edit opens the form below the item with the `fields` the list allows,
	 * name and description first; Save sends `save` only the fields changed,
	 * so a file never gains a line nobody edited. Delete asks `ask` in place
	 * before calling `remove`. A refusal is shown and the form stays open;
	 * success closes it. Reloading the list is `save`'s and `remove`'s to do.
	 *
	 * Lays out as its parts, not a box (`display: contents`): the controls sit
	 * where they are placed, and the form takes a line of its own in a
	 * wrapping row or a column.
	 */
	import { untrack } from 'svelte';
	import type { Result } from '$lib/client/api';

	let {
		details,
		fields = ['name', 'description'],
		save,
		remove,
		ask = 'Delete this?',
		fileHref
	}: {
		details: Details;
		/** Which fields the form edits. */
		fields?: DetailField[];
		save: (changed: Partial<Details>) => Promise<Result<unknown>>;
		/** Deletes the item; without it there is no Delete. */
		remove?: () => Promise<Result<unknown>>;
		/** The question Delete asks first, saying what goes and what stays. */
		ask?: string;
		/** The file the details are written in, offered from the form. */
		fileHref?: string;
	} = $props();

	let editing = $state(false);
	let asking = $state(false);
	let initial = $state<Required<Details>>(blank());
	let draft = $state<Required<Details>>(blank());
	let saving = $state(false);
	let problem = $state('');

	function blank(): Required<Details> {
		return { name: '', description: '', color: '', tag: '' };
	}

	function open() {
		const now = untrack(() => ({ ...blank(), ...details }));
		initial = now;
		draft = { ...now };
		problem = '';
		asking = false;
		editing = true;
	}

	const shows = (field: DetailField) => fields.includes(field);
	const tagChanged = $derived(draft.tag.trim().replace(/^#/, '') !== initial.tag);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const changed = Object.fromEntries(fields.filter((f) => draft[f].trim() !== initial[f]).map((f) => [f, draft[f]])) as Partial<Details>;
		if (!Object.keys(changed).length) {
			editing = false;
			return;
		}
		saving = true;
		problem = '';
		const result = await save(changed);
		saving = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		editing = false;
	}

	async function confirmRemove() {
		if (!remove) return;
		problem = '';
		const result = await remove();
		if (!result.ok) problem = result.message;
		asking = false;
	}
</script>

<div class="edit-details">
	<span class="controls">
		{#if asking}
			<span class="ask" data-testid="delete-details-ask">
				{ask}
				<button class="link-btn remove" onclick={confirmRemove} data-testid="delete-details-confirm">Delete</button>
				<button class="link-btn" onclick={() => (asking = false)}>Keep</button>
			</span>
		{:else if !editing}
			<button class="link-btn" onclick={open} aria-label="Edit {details.name}" data-testid="edit-details">Edit</button>
			{#if remove}<button class="link-btn remove" onclick={() => (asking = true)} aria-label="Delete {details.name}" data-testid="delete-details">Delete</button>{/if}
		{/if}
		{#if problem && !editing}<span class="problem" role="alert">{problem}</span>{/if}
	</span>

	{#if editing}
		<form class="sheet form" onsubmit={submit} data-testid="details-form">
			<label class="form-row">
				<span>Name</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input class="field" bind:value={draft.name} autofocus autocomplete="off" data-testid="details-name" />
			</label>

			<label class="form-row">
				<span>Description</span>
				<textarea class="field" rows="2" bind:value={draft.description} placeholder="What this is for, in a line" data-testid="details-description-field"></textarea>
			</label>

			{#if shows('color')}
				<label class="form-row">
					<span>Colour</span>
					<input class="swatch" type="color" bind:value={draft.color} data-testid="details-color" />
					<code>{draft.color}</code>
				</label>
			{/if}

			{#if shows('tag')}
				<label class="form-row">
					<span>Tag</span>
					<input class="field" bind:value={draft.tag} autocomplete="off" spellcheck="false" data-testid="details-tag" />
				</label>
				{#if tagChanged}
					<p class="hint" data-testid="details-tag-hint">Tasks tagged <code>#{initial.tag}</code> keep that tag, and stop belonging here.</p>
				{/if}
			{/if}

			{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

			<div class="actions">
				{#if fileHref}<a class="small" href={fileHref}>Open the file</a>{/if}
				<button class="btn" type="button" onclick={() => (editing = false)}>Cancel</button>
				<button class="btn primary" disabled={saving || !draft.name.trim()} data-testid="details-save">{saving ? 'Saving…' : 'Save'}</button>
			</div>
		</form>
	{/if}
</div>

<style>
	/* Invisible to layout: the controls and the form are laid out by the
	   row or card around them, the form taking a line of its own. */
	.edit-details { display: contents; }
	.controls { display: inline-flex; align-items: center; gap: var(--s2); position: relative; z-index: 1; font-size: var(--t13); }
	.ask { display: inline-flex; align-items: center; gap: var(--s1); flex-wrap: wrap; }
	.link-btn { padding: 0; border: 0; background: none; font: inherit; color: var(--accent); cursor: pointer; }
	.link-btn:hover { text-decoration: underline; }
	.link-btn.remove { color: var(--bad); }

	.form { position: relative; z-index: 1; flex-basis: 100%; max-width: 640px; padding: var(--s4); margin: var(--s2) 0; text-align: left; font-family: var(--sans); font-weight: 400; display: flex; flex-direction: column; gap: var(--s3); }
	.form-row { display: flex; align-items: center; gap: var(--s3); }
	.form-row > span { flex: none; width: 90px; font-size: var(--t12); color: var(--muted); }
	.swatch { width: var(--s6); height: 32px; padding: 0; border: 1px solid var(--line); border-radius: var(--r-md); background: none; cursor: pointer; }
	.hint { margin: -4px 0 0 96px; }
	.actions { display: flex; align-items: center; gap: var(--s2); justify-content: flex-end; }
	.actions a { margin-right: auto; }
	code { font: var(--t11) var(--mono); background: var(--soft); border-radius: 4px; padding: 1px 5px; }

	@media (max-width: 720px) {
		.form-row { flex-direction: column; align-items: stretch; gap: var(--s1); }
		.form-row > span { width: auto; }
		.hint { margin-left: 0; }
	}
</style>
