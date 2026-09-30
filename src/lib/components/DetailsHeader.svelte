<script lang="ts" module>
	/** What a page says about the thing it shows, and what its Edit form can change. */
	export interface Details {
		name: string;
		/** One line: the paragraph under the title of the thing's own file. */
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
	 * The heading every page about one thing shares — a workspace, a study
	 * subject, a glossary — and the one form that edits it.
	 *
	 * Draws the crumb, the coloured name, the description (or `fallback` when
	 * there is none), a meta line, and Edit. Edit opens the form in place with
	 * the `fields` the page allows, name and description first; Save sends
	 * `save` only the fields changed, so a file never gains a line nobody
	 * edited. A refusal is shown in the form, which stays open; success closes
	 * it, and reloading or moving to the renamed page is `save`'s to do.
	 */
	import { untrack, type Snippet } from 'svelte';
	import type { Result } from '$lib/client/api';

	let {
		details,
		fields = ['name', 'description'],
		save,
		crumb,
		fallback = '',
		fileHref,
		meta,
		actions
	}: {
		details: Details;
		/** Which fields the form edits. */
		fields?: DetailField[];
		save: (changed: Partial<Details>) => Promise<Result<unknown>>;
		crumb?: { href: string; label: string };
		/** Shown in the description's place when there is none. */
		fallback?: string;
		/** The file the details are written in, offered from the form. */
		fileHref?: string;
		/** Before Edit on the line under the description: a tag, a count. */
		meta?: Snippet;
		/** After Edit on the same line: the page's own, such as Delete. */
		actions?: Snippet;
	} = $props();

	let editing = $state(false);
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
</script>

<div class="title">
	{#if crumb}<a class="crumb" href={crumb.href}>{crumb.label}</a>{/if}
	<h1>{#if details.color}<span class="dot lg" style="--dot: {details.color}"></span>{/if}{details.name}</h1>
	{#if details.description || fallback}<p data-testid="details-description">{details.description || fallback}</p>{/if}
	<p class="line">
		{@render meta?.()}
		{#if !editing}<button class="link-btn" onclick={open} data-testid="edit-details">Edit</button>{/if}
		{@render actions?.()}
	</p>
</div>

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

<style>
	h1 { display: flex; align-items: center; gap: var(--s2); }
	.line { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
	.link-btn { padding: 0; border: 0; background: none; font: inherit; color: var(--accent); cursor: pointer; }
	.link-btn:hover { text-decoration: underline; }

	.form { max-width: 640px; padding: var(--s4); margin-bottom: var(--s4); display: flex; flex-direction: column; gap: var(--s3); }
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
