<script lang="ts">
	/**
	 * Cute: every character as a tile, and a box on top to file a new image.
	 *
	 * Drop a file on the box, paste one anywhere on the page, or choose one
	 * (all a phone can do, so a touch screen is only offered that).
	 * The box shows it and the grid turns into the choice of where it goes:
	 * each tile reads "Add here", and a New character tile comes first. One tap
	 * files it (`/api/cute`, the image's own bytes), which converts a screenshot to WebP and appends
	 * one line to the character's note. Nothing is written before that tap.
	 */
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	/** The largest file the server takes; checked here first to say so at once. */
	const MAX_MB = 25;

	let pending = $state<File | null>(null);
	let preview = $state('');
	/** True when the image came from the clipboard, where a GIF arrives as a still. */
	let pasted = $state(false);
	let dragging = $state(false);
	let busy = $state(false);
	let problem = $state('');
	let done = $state<{ character: string; slug: string } | null>(null);
	let newName = $state('');
	let input = $state<HTMLInputElement>();

	function take(file: File | null | undefined, fromClipboard: boolean) {
		problem = '';
		done = null;
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			problem = 'That is not an image.';
			return;
		}
		if (file.size > MAX_MB * 1024 * 1024) {
			problem = `That image is over ${MAX_MB} MB.`;
			return;
		}
		if (preview) URL.revokeObjectURL(preview);
		pending = file;
		preview = URL.createObjectURL(file);
		pasted = fromClipboard;
	}

	function cancel() {
		if (preview) URL.revokeObjectURL(preview);
		pending = null;
		preview = '';
		newName = '';
		problem = '';
	}

	onMount(() => {
		const onPaste = (event: ClipboardEvent) => {
			const item = [...(event.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
			if (!item) return;
			event.preventDefault();
			take(item.getAsFile(), true);
		};
		window.addEventListener('paste', onPaste);
		return () => {
			window.removeEventListener('paste', onPaste);
			if (preview) URL.revokeObjectURL(preview);
		};
	});

	async function file(to: { character: string } | { create: string }) {
		if (!pending || busy) return;
		busy = true;
		problem = '';
		const query = 'character' in to ? `character=${encodeURIComponent(to.character)}` : `create=${encodeURIComponent(to.create)}`;
		try {
			const res = await fetch(`/api/cute?${query}`, { method: 'POST', headers: { 'content-type': pending.type }, body: pending });
			const answer = await res.json().catch(() => ({ ok: false, error: res.status === 413 ? 'That image is too big for the server.' : 'That did not work.' }));
			if (!res.ok || !answer.ok) problem = answer.error ?? 'That did not work.';
			else {
				done = { character: answer.character, slug: answer.slug };
				cancel();
				await invalidateAll();
			}
		} catch {
			problem = 'No answer from the server. Check the connection and try again.';
		}
		busy = false;
	}
</script>

<svelte:head><title>Cute · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Cute</h1>
		<p>Drop or paste an image, then tap who it is.</p>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="drop"
		class:dragging
		class:full={pending}
		ondragover={(e) => {
			e.preventDefault();
			dragging = true;
		}}
		ondragleave={() => (dragging = false)}
		ondrop={(e) => {
			e.preventDefault();
			dragging = false;
			take(e.dataTransfer?.files[0], false);
		}}
		data-testid="drop"
	>
		{#if pending}
			<img class="preview" src={preview} alt="To be filed" data-testid="preview" />
			<div class="what">
				<p><b>Where does it go?</b> Tap a character below, or make a new one.</p>
				{#if pasted && pending.type !== 'image/gif'}
					<p class="muted small" data-testid="still-hint">Pasted images arrive as a still. To keep a GIF moving, drag the file in instead.</p>
				{/if}
				<button type="button" class="btn ghost" onclick={cancel} disabled={busy} data-testid="cancel">Cancel</button>
			</div>
		{:else}
			<p class="pointer"><b>Drop an image here</b>, or press <kbd>⌘</kbd> <kbd>V</kbd> anywhere on the page.</p>
			<p class="touch"><b>Add a screenshot or GIF</b> from your photos.</p>
			<button type="button" class="btn" onclick={() => input?.click()} data-testid="choose-file"><span class="pointer">Choose a file</span><span class="touch">Choose a photo</span></button>
		{/if}
		<input bind:this={input} class="hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onchange={(e) => take(e.currentTarget.files?.[0], false)} data-testid="file-input" />
	</div>

	{#if problem}<p class="problem" role="status" data-testid="cute-problem">{problem}</p>{/if}
	{#if done}<p class="done" role="status" data-testid="filed">Added to <a href="/cute/{done.slug}">{done.character}</a>.</p>{/if}

	<div class="grid" class:choosing={pending} data-testid="characters">
		{#if pending}
			<form
				class="tile new"
				onsubmit={(e) => {
					e.preventDefault();
					if (newName.trim()) file({ create: newName.trim() });
				}}
			>
				<span class="plus" aria-hidden="true">+</span>
				<input class="field" bind:value={newName} placeholder="New character" aria-label="New character's name" data-testid="new-character" />
				<button class="btn primary" disabled={busy || !newName.trim()} data-testid="create-character">Make and add</button>
			</form>
		{/if}
		{#each data.characters as c (c.slug)}
			{#if pending}
				<button type="button" class="tile pick" disabled={busy} onclick={() => file({ character: c.slug })} data-testid="add-here">
					{#if c.cover}<img src={c.cover.src} alt="" loading="lazy" referrerpolicy="no-referrer" />{:else}<span class="blank"></span>{/if}
					<span class="name">{c.name}</span>
					<span class="cta">Add here</span>
				</button>
			{:else}
				<a class="tile" href="/cute/{c.slug}" data-testid="character">
					{#if c.cover}<img src={c.cover.src} alt="" loading="lazy" referrerpolicy="no-referrer" />{:else}<span class="blank"></span>{/if}
					<span class="name">{c.name}</span>
					<span class="count muted small num">{c.count} {c.count === 1 ? 'image' : 'images'}</span>
				</a>
			{/if}
		{:else}
			{#if !pending}<p class="empty">No characters yet. Drop an image above to make the first.</p>{/if}
		{/each}
	</div>
</div>

<style>
	.drop {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--s4);
		flex-wrap: wrap;
		min-height: 120px;
		padding: var(--s4);
		margin-bottom: var(--s4);
		border: 2px dashed var(--line);
		border-radius: var(--r-md);
		background: var(--panel);
		text-align: center;
	}
	.drop p { margin: 0; }
	.drop.dragging { border-color: var(--accent); background: var(--accent-soft); }
	.drop.full { justify-content: flex-start; text-align: left; border-style: solid; border-color: var(--accent); }
	.preview { max-height: 180px; max-width: 280px; border-radius: var(--r); object-fit: contain; }
	.what { display: flex; flex-direction: column; align-items: flex-start; gap: var(--s2); }
	kbd { font: inherit; font-size: var(--t13); padding: 1px 6px; border: 1px solid var(--line); border-radius: 4px; background: var(--soft); }
	.hidden { display: none; }
	/* A phone can neither drop a file nor paste outside a text box, so it is told to choose one. */
	.touch { display: none; }
	@media (hover: none) and (pointer: coarse) {
		.pointer { display: none; }
		.touch { display: inline; }
		p.touch { display: block; }
	}
	.done { margin: 0 0 var(--s3); }

	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: var(--s3); }
	.tile {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: var(--s2);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--panel);
		color: var(--text);
		font: inherit;
		text-align: left;
	}
	a.tile:hover { border-color: var(--accent); text-decoration: none; }
	.tile img, .blank { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--r); background: var(--soft); }
	.tile .name { font-weight: 600; }
	.pick { cursor: pointer; }
	.pick:hover:not(:disabled), .pick:focus-visible { border-color: var(--accent); background: var(--accent-soft); }
	.pick .cta { color: var(--accent); font-size: var(--t13); font-weight: 600; }
	.new { justify-content: center; align-items: stretch; border-style: dashed; border-color: var(--accent); }
	.plus { font-size: 40px; line-height: 1; color: var(--accent); text-align: center; }
</style>
