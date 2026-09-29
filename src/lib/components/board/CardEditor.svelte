<script lang="ts">
	/**
	 * One board card, opened for editing: its title, due date, priority,
	 * labels and notes, plus done and which column it is in.
	 *
	 * Built on the native `<dialog>`, as `CardDrawer` is, for the focus trap,
	 * Escape and backdrop. Each field is sent as soon as it is left, one edit
	 * at a time, through the board that opened it: this component holds no
	 * board and makes no request. The card it shows is always the board's
	 * current copy, so a save that changes it redraws the fields.
	 */
	import { untrack } from 'svelte';
	import type { BoardCard } from '$lib/shared/kanban';

	type Fields = { title?: string; due?: string | null; priority?: number | null; labels?: string[]; notes?: string };

	let {
		card,
		column,
		columns,
		busy = false,
		problem = '',
		onsave,
		ontoggle,
		onmove,
		onclose
	}: {
		card: BoardCard;
		/** Index of the column the card is in. */
		column: number;
		columns: string[];
		busy?: boolean;
		problem?: string;
		onsave: (fields: Fields) => void;
		ontoggle: (done: boolean) => void;
		onmove: (column: number) => void;
		onclose: () => void;
	} = $props();

	// Text fields are the drawer's own while it is open: a save reloads the
	// card, and overwriting a field someone is still typing in would lose
	// their keystrokes. Choices (due, priority, column) read the card directly.
	let title = $state(untrack(() => card.title));
	let labels = $state(untrack(() => card.labels.map((l) => `#${l}`).join(' ')));
	let notes = $state(untrack(() => card.notes));
	let dialog: HTMLDialogElement | undefined = $state();
	let field: HTMLInputElement | undefined = $state();

	$effect(() => {
		if (!dialog?.open) dialog?.showModal();
		untrack(() => field?.focus());
	});

	function saveTitle() {
		const next = title.replace(/\s+/g, ' ').trim();
		if (!next) title = card.title;
		else if (next !== card.title) onsave({ title: next });
	}

	function saveLabels() {
		const next = labels
			.split(/[\s,]+/)
			.map((l) => l.replace(/^#+/, ''))
			.filter(Boolean);
		if (next.join(' ') !== card.labels.join(' ')) onsave({ labels: next });
	}

	function saveNotes() {
		if (notes.replace(/\s+$/, '') !== card.notes) onsave({ notes });
	}

	/** A click that lands on the dialog itself came from the backdrop. */
	function maybeBackdrop(event: MouseEvent) {
		if (event.target === dialog) onclose();
	}

	const enter = (save: () => void) => (e: KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			save();
		}
	};
</script>

<dialog bind:this={dialog} onclose={onclose} onclick={maybeBackdrop} data-testid="card-editor" aria-label="Card: {card.title}">
	<div class="inner">
		<header>
			<button
				class="box"
				class:done={card.done}
				data-testid="editor-done"
				aria-pressed={card.done}
				aria-label={card.done ? 'Mark not done' : 'Mark done'}
				disabled={busy}
				onclick={() => ontoggle(!card.done)}
			>{card.done ? '✓' : ''}</button>
			<input
				class="title-field"
				bind:this={field}
				bind:value={title}
				data-testid="editor-title"
				aria-label="Title"
				onblur={saveTitle}
				onkeydown={enter(saveTitle)}
			/>
			<button class="icon-btn" data-testid="editor-close" onclick={onclose} aria-label="Close">✕</button>
		</header>

		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

		<div class="grid">
			<label class="row">
				<span>Due</span>
				<input
					type="date"
					class="field"
					data-testid="editor-due"
					value={card.due ?? ''}
					disabled={busy}
					onchange={(e) => onsave({ due: e.currentTarget.value || null })}
				/>
			</label>
			<label class="row">
				<span>Priority</span>
				<select
					class="field"
					data-testid="editor-priority"
					value={card.priority === null ? '' : String(card.priority)}
					disabled={busy}
					onchange={(e) => onsave({ priority: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
				>
					<option value="">None</option>
					{#each [1, 2, 3, 4] as q (q)}<option value={String(q)}>Q{q}</option>{/each}
				</select>
			</label>
			<label class="row">
				<span>Column</span>
				<select class="field" data-testid="editor-column" value={String(column)} disabled={busy} onchange={(e) => onmove(Number(e.currentTarget.value))}>
					{#each columns as name, i (i)}<option value={String(i)}>{name}</option>{/each}
				</select>
			</label>
			<label class="row">
				<span>Labels</span>
				<input
					class="field"
					bind:value={labels}
					data-testid="editor-labels"
					placeholder="#print #urgent"
					onblur={saveLabels}
					onkeydown={enter(saveLabels)}
				/>
			</label>
		</div>

		<label class="notes">
			<span>Notes</span>
			<textarea class="field" bind:value={notes} data-testid="editor-notes" rows="6" placeholder="Anything else about it" onblur={saveNotes}></textarea>
		</label>
		<p class="hint">Saved as you leave each field.</p>
	</div>
</dialog>

<style>
	dialog {
		border: 0;
		padding: 0;
		border-radius: var(--r-lg);
		max-width: 560px;
		width: calc(100% - 40px);
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-lg);
	}
	dialog::backdrop { background: rgba(31, 35, 40, 0.4); }
	.inner { padding: var(--s4) 18px 18px; display: flex; flex-direction: column; gap: var(--s3); }
	header { display: flex; align-items: center; gap: var(--s2); }
	.title-field {
		flex: 1;
		min-width: 0;
		border: 0;
		border-bottom: 1px solid transparent;
		background: none;
		padding: var(--s1) 0;
		font: 600 var(--t16) var(--serif);
		color: var(--text);
	}
	.title-field:hover { border-bottom-color: var(--line); }
	.title-field:focus { outline: none; border-bottom-color: var(--accent); }

	.box {
		flex: none;
		width: 18px;
		height: 18px;
		padding: 0;
		border: 1.5px solid #9aa0a6;
		border-radius: 3px;
		background: var(--field);
		font-size: var(--t11);
		line-height: 1;
		color: #fff;
		cursor: pointer;
	}
	.box.done { background: var(--accent); border-color: var(--accent); }

	.grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s2) var(--s4); }
	.row { display: flex; align-items: center; gap: var(--s2); }
	.row > span, .notes > span { flex: none; width: 64px; font-size: var(--t12); color: var(--muted); }
	.row .field { flex: 1; min-width: 0; }
	.notes { display: flex; flex-direction: column; gap: var(--s1); }
	.notes textarea { resize: vertical; font-size: var(--t14); line-height: 1.5; }
	.hint { margin: 0; font-size: var(--t12); }
	.problem { margin: 0; }

	@media (max-width: 720px) {
		.grid { grid-template-columns: 1fr; }
	}
</style>
