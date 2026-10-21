<script lang="ts">
	/**
	 * One character: every picture in its note, newest first, as a grid. Tap
	 * one to see it full size, GIFs playing; arrow keys or a sideways swipe move
	 * between them and Escape closes. Filing a new one happens on the Cute page.
	 */
	import { noteHref } from '$lib/shared/links';

	let { data } = $props();

	let open = $state<number | null>(null);
	let dialog = $state<HTMLDialogElement>();

	function show(i: number) {
		open = i;
		dialog?.showModal();
	}

	function step(by: number) {
		if (open === null || !data.pictures.length) return;
		open = (open + by + data.pictures.length) % data.pictures.length;
	}

	function onKey(event: KeyboardEvent) {
		if (open === null) return;
		if (event.key === 'ArrowRight') step(1);
		if (event.key === 'ArrowLeft') step(-1);
	}

	/** Where a touch began, so a sideways swipe can page like the arrow keys. */
	let touchX: number | null = null;

	function onTouchEnd(event: TouchEvent) {
		if (touchX === null) return;
		const dx = event.changedTouches[0].clientX - touchX;
		touchX = null;
		if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
	}
</script>

<svelte:head><title>{data.name} · Cute · prosoche</title></svelte:head>
<svelte:window onkeydown={onKey} />

<div class="page">
	<div class="title">
		<a class="crumb" href="/cute">Cute</a>
		<h1>{data.name}</h1>
		<p class="line muted small">
			{data.pictures.length} {data.pictures.length === 1 ? 'image' : 'images'} · <a href={noteHref(data.path)}>Open the note</a>
		</p>
	</div>

	<div class="grid" data-testid="pictures">
		{#each data.pictures as picture, i (i)}
			<button type="button" class="pic" onclick={() => show(i)} aria-label="View {picture.label}" data-testid="picture">
				<img src={picture.src} alt="" loading="lazy" referrerpolicy="no-referrer" />
				{#if picture.gif}<span class="badge">GIF</span>{/if}
			</button>
		{:else}
			<p class="empty">No images yet. File one from the <a href="/cute">Cute</a> page.</p>
		{/each}
	</div>
</div>

<dialog
	bind:this={dialog}
	class="viewer"
	onclose={() => (open = null)}
	ontouchstart={(e) => (touchX = e.touches[0].clientX)}
	ontouchend={onTouchEnd}
	data-testid="viewer"
>
	{#if open !== null && data.pictures[open]}
		{@const picture = data.pictures[open]}
		<img src={picture.src} alt={picture.label} referrerpolicy="no-referrer" />
		<div class="bar">
			<button type="button" class="btn ghost" onclick={() => step(-1)} aria-label="Previous">←</button>
			<span class="muted small label">{open + 1} of {data.pictures.length}{picture.remote ? ' · from the web' : ''}</span>
			<button type="button" class="btn ghost" onclick={() => step(1)} aria-label="Next">→</button>
			<button type="button" class="btn" onclick={() => dialog?.close()} data-testid="close-viewer">Close</button>
		</div>
	{/if}
</dialog>

<style>
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--s3); }
	.pic { position: relative; padding: 0; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--soft); cursor: zoom-in; overflow: hidden; }
	.pic:hover, .pic:focus-visible { border-color: var(--accent); }
	.pic img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
	.badge { position: absolute; top: 6px; left: 6px; padding: 1px 6px; border-radius: var(--r-pill); background: rgba(0, 0, 0, 0.6); color: #fff; font-size: var(--t11); font-weight: 600; }

	.viewer { max-width: 96vw; max-height: 96vh; padding: var(--s3); border: 0; border-radius: var(--r-md); background: var(--panel); }
	.viewer::backdrop { background: rgba(0, 0, 0, 0.75); }
	.viewer img { display: block; max-width: 92vw; max-height: 82vh; margin: 0 auto; object-fit: contain; }
	.bar { display: flex; align-items: center; gap: var(--s2); margin-top: var(--s2); }
	.label { flex: 1; text-align: center; }
</style>
