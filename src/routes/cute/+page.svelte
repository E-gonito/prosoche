<script lang="ts">
	/**
	 * Cute: every character as a tile, and a box on top to file new images.
	 *
	 * Drop files on the box, paste anywhere on the page, or choose some (all
	 * a phone can do, so a touch screen is only offered that; its picker takes
	 * several at once). The box shows them as a batch, any one of which can be
	 * left out, and the grid turns into the choice of where they go: each tile
	 * reads "Add here", and a New character tile comes first. One tap files
	 * the whole batch to that character, one image at a time (`/api/cute`,
	 * each image's own bytes), which converts a screenshot to WebP and appends
	 * one line per image to the character's note. Nothing is written before
	 * that tap; if one fails, the ones filed stay filed and the rest stay in
	 * the box.
	 */
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	/** The largest file the server takes; checked here first to say so at once. */
	const MAX_MB = 25;

	/** One image waiting to be filed; `pasted` because a GIF from the clipboard arrives as a still. */
	type Pending = { file: File; url: string; pasted: boolean };

	let pending = $state<Pending[]>([]);
	/** How many of the batch being filed are done, for "Filing 3 of 8". */
	let filed = $state(0);
	let dragging = $state(false);
	let busy = $state(false);
	let problem = $state('');
	let done = $state<{ character: string; slug: string; count: number } | null>(null);
	let newName = $state('');
	let input = $state<HTMLInputElement>();

	const stillHint = $derived(pending.some((p) => p.pasted && p.file.type !== 'image/gif'));

	function take(files: Iterable<File | null | undefined>, fromClipboard: boolean) {
		problem = '';
		done = null;
		const left: string[] = [];
		const added: Pending[] = [];
		for (const file of files) {
			if (!file) continue;
			if (!file.type.startsWith('image/')) left.push(`${file.name || 'one file'} is not an image`);
			else if (file.size > MAX_MB * 1024 * 1024) left.push(`${file.name || 'one image'} is over ${MAX_MB} MB`);
			else added.push({ file, url: URL.createObjectURL(file), pasted: fromClipboard });
		}
		pending = [...pending, ...added];
		if (left.length) problem = `Left out: ${left.join('; ')}.`;
	}

	function remove(i: number) {
		URL.revokeObjectURL(pending[i].url);
		pending = pending.filter((_, j) => j !== i);
	}

	function cancel() {
		for (const p of pending) URL.revokeObjectURL(p.url);
		pending = [];
		newName = '';
		problem = '';
	}

	onMount(() => {
		const onPaste = (event: ClipboardEvent) => {
			const items = [...(event.clipboardData?.items ?? [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/'));
			if (!items.length) return;
			event.preventDefault();
			take(items.map((i) => i.getAsFile()), true);
		};
		window.addEventListener('paste', onPaste);
		return () => {
			window.removeEventListener('paste', onPaste);
			for (const p of pending) URL.revokeObjectURL(p.url);
		};
	});

	/** File the whole batch to `to`, in order; a new character is made by the first and the rest follow it. */
	async function file(to: { character: string } | { create: string }) {
		if (!pending.length || busy) return;
		busy = true;
		problem = '';
		filed = 0;
		let target = to;
		let last: { character: string; slug: string } | null = null;
		while (pending.length) {
			const next = pending[0];
			const query = 'character' in target ? `character=${encodeURIComponent(target.character)}` : `create=${encodeURIComponent(target.create)}`;
			let error = '';
			try {
				const res = await fetch(`/api/cute?${query}`, { method: 'POST', headers: { 'content-type': next.file.type }, body: next.file });
				const answer = await res.json().catch(() => ({ ok: false, error: res.status === 413 ? 'That image is too big for the server.' : 'That did not work.' }));
				if (!res.ok || !answer.ok) error = answer.error ?? 'That did not work.';
				else {
					last = { character: answer.character, slug: answer.slug };
					target = { character: answer.slug };
				}
			} catch {
				error = 'No answer from the server. Check the connection and try again.';
			}
			if (error) {
				problem = filed ? `${filed} filed; the rest are still here. ${error}` : error;
				break;
			}
			URL.revokeObjectURL(next.url);
			pending = pending.slice(1);
			filed++;
		}
		if (last) {
			done = { ...last, count: filed };
			await invalidateAll();
		}
		if (!pending.length) newName = '';
		busy = false;
	}
</script>

<svelte:head><title>Cute · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Cute</h1>
		<p>Drop, paste or choose images, then tap who they are.</p>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="drop"
		class:dragging
		class:full={pending.length}
		ondragover={(e) => {
			e.preventDefault();
			dragging = true;
		}}
		ondragleave={() => (dragging = false)}
		ondrop={(e) => {
			e.preventDefault();
			dragging = false;
			take(e.dataTransfer?.files ?? [], false);
		}}
		data-testid="drop"
	>
		{#if pending.length === 1}
			<img class="preview" src={pending[0].url} alt="To be filed" data-testid="preview" />
		{:else if pending.length}
			<ul class="batch" data-testid="batch">
				{#each pending as p, i (p.url)}
					<li>
						<img src={p.url} alt="To be filed" data-testid="preview" />
						<button type="button" class="leave" onclick={() => remove(i)} disabled={busy} aria-label="Leave this one out" data-testid="leave-out">×</button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if pending.length}
			<div class="what">
				<p><b>Where {pending.length === 1 ? 'does it' : `do these ${pending.length}`} go?</b> Tap a character below, or make a new one.</p>
				{#if busy}<p class="muted small" data-testid="progress">Filing {filed + 1} of {filed + pending.length}…</p>{/if}
				{#if stillHint}
					<p class="muted small" data-testid="still-hint">Pasted images arrive as a still. To keep a GIF moving, drag the file in instead.</p>
				{/if}
				<div class="actions">
					<button type="button" class="btn" onclick={() => input?.click()} disabled={busy} data-testid="add-more">Add more</button>
					<button type="button" class="btn ghost" onclick={cancel} disabled={busy} data-testid="cancel">Cancel</button>
				</div>
			</div>
		{:else}
			<p class="pointer"><b>Drop images here</b>, or press <kbd>⌘</kbd> <kbd>V</kbd> anywhere on the page.</p>
			<p class="touch"><b>Add screenshots or GIFs</b> from your photos, as many as you like.</p>
			<button type="button" class="btn" onclick={() => input?.click()} data-testid="choose-file"><span class="pointer">Choose files</span><span class="touch">Choose photos</span></button>
		{/if}
		<input
			bind:this={input}
			class="hidden"
			type="file"
			multiple
			accept="image/png,image/jpeg,image/gif,image/webp"
			onchange={(e) => {
				take(e.currentTarget.files ?? [], false);
				e.currentTarget.value = '';
			}}
			data-testid="file-input"
		/>
	</div>

	{#if problem}<p class="problem" role="status" data-testid="cute-problem">{problem}</p>{/if}
	{#if done}
		<p class="done" role="status" data-testid="filed">
			Added {done.count === 1 ? '' : `${done.count} images `}to <a href="/cute/{done.slug}">{done.character}</a>.
		</p>
	{/if}

	<div class="grid" class:choosing={pending.length} data-testid="characters">
		{#if pending.length}
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
			{#if pending.length}
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
			{#if !pending.length}<p class="empty">No characters yet. Add an image above to make the first.</p>{/if}
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
	.actions { display: flex; gap: var(--s2); }
	.batch { display: flex; flex-wrap: wrap; gap: var(--s2); width: 100%; max-height: 260px; overflow-y: auto; margin: 0; padding: 0; list-style: none; }
	.batch li { position: relative; }
	.batch img { display: block; width: 76px; height: 76px; object-fit: cover; border-radius: var(--r); background: var(--soft); }
	.leave {
		position: absolute;
		top: -6px;
		right: -6px;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--panel);
		color: var(--text);
		font: inherit;
		line-height: 1;
		cursor: pointer;
	}
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
