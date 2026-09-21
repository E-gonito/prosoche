<script lang="ts">
	/**
	 * A modal that has to be dismissed deliberately, shown before anything
	 * irreversible.
	 *
	 * Built on the native `<dialog>`, which brings focus trapping, Escape to
	 * close and a real backdrop without reimplementing any of it. The
	 * destructive button is never the one focused on open, so a stray keypress
	 * cannot confirm it.
	 */
	let {
		title,
		body = '',
		items = [],
		confirmLabel = 'Confirm',
		danger = false,
		onconfirm,
		oncancel
	}: {
		title: string;
		body?: string;
		items?: string[];
		confirmLabel?: string;
		danger?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let cancelButton: HTMLButtonElement | undefined = $state();

	$effect(() => {
		if (!dialog?.open) dialog?.showModal();
		cancelButton?.focus();
	});

	/** A click landing on the dialog itself came from the backdrop. */
	function maybeBackdrop(event: MouseEvent) {
		if (event.target === dialog) oncancel();
	}
</script>

<dialog bind:this={dialog} onclose={oncancel} onclick={maybeBackdrop} aria-label={title}>
	<div class="inner">
		<h2>{title}</h2>
		{#if body}<p>{body}</p>{/if}
		{#if items.length}
			<ul>
				{#each items.slice(0, 12) as item (item)}<li>{item}</li>{/each}
				{#if items.length > 12}<li class="more">and {items.length - 12} more</li>{/if}
			</ul>
		{/if}
		<div class="row">
			<button class="btn" bind:this={cancelButton} onclick={oncancel}>Cancel</button>
			<button class="btn" class:danger class:primary={!danger} onclick={onconfirm}>{confirmLabel}</button>
		</div>
	</div>
</dialog>

<style>
	dialog {
		border: 0;
		padding: 0;
		border-radius: 12px;
		max-width: 520px;
		width: calc(100% - 40px);
		background: var(--panel);
		color: var(--text);
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.3);
	}
	dialog::backdrop { background: rgba(31, 35, 40, 0.4); }
	.inner { padding: 20px 22px; }
	h2 { margin: 0 0 8px; font-size: 17px; }
	p { margin: 0 0 12px; color: var(--muted); font-size: 13px; }
	ul {
		margin: 0 0 14px;
		padding: 10px 12px 10px 28px;
		background: var(--soft);
		border-radius: 8px;
		font: 12px var(--mono);
		max-height: 220px;
		overflow: auto;
	}
	li { margin: 2px 0; word-break: break-all; }
	.more { list-style: none; margin-left: -14px; color: var(--muted); font-family: inherit; }
	.row { display: flex; gap: 8px; justify-content: flex-end; }
	.danger { background: var(--bad); border-color: var(--bad); color: #fff; }
	.danger:hover { background: #a11414; }
</style>
