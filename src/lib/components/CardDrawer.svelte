<script lang="ts">
	/**
	 * One card, opened for editing.
	 *
	 * Built on the native `<dialog>`, which brings the focus trap, Escape to
	 * close and a real backdrop without reimplementing any of them — the same
	 * choice `Confirm.svelte` makes, for the same reason.
	 *
	 * Every field writes through `editTask`, so each change is one line of one
	 * note rewritten through character spans, guarded against that line having
	 * changed on another device. The card's sub-bullets are shown as written
	 * and never edited here: they are prose, and the editor is a click away.
	 */
	import { untrack } from 'svelte';
	import { displayText, workspaceTags, type Task, type TaskStatus } from '$lib/shared/task';
	import { editTask, type TaskEdit } from '$lib/client/api';
	import { cardContext, type CardContext } from '$lib/client/cards';

	let {
		task,
		onclose,
		onchange
	}: { task: Task; onclose: () => void; onchange?: (task: Task) => void } = $props();

	const STATUSES: Array<{ value: TaskStatus; label: string }> = [
		{ value: 'todo', label: 'To do' },
		{ value: 'in-progress', label: 'In progress' },
		{ value: 'blocked', label: 'Blocked' },
		{ value: 'done', label: 'Done' },
		{ value: 'cancelled', label: 'Cancelled' }
	];

	// The drawer is opened for one card and closed again, so these start from
	// the card it was opened with and are owned by the drawer from then on.
	let current = $state(untrack(() => task));
	let context = $state<CardContext | null>(null);
	let text = $state(untrack(() => task.text));
	let blockedBy = $state(untrack(() => task.blockedBy.join(', ')));
	let problem = $state('');
	let saving = $state(false);
	let dialog: HTMLDialogElement | undefined = $state();
	let field: HTMLInputElement | undefined = $state();

	const pinned = $derived(current.tags.includes('pin'));
	// What the line says now, which is what the select shows: the header's dot
	// may name a workspace the folder or an alias gave it, but this control
	// writes tags and so reports tags.
	const tagged = $derived(workspaceTags(current)[0] ?? '');
	const href = $derived(`/notes/${current.path.split('/').map(encodeURIComponent).join('/')}`);

	$effect(() => {
		if (!dialog?.open) dialog?.showModal();
		field?.focus();
	});

	// The bytes around the line, read when the drawer opens. A failure here
	// leaves the fields working: the context is extra, not the point.
	$effect(() => {
		void (async () => {
			const result = await cardContext(task.path, task.line);
			if (result.ok) context = result.value;
		})();
	});

	async function save(edit: TaskEdit) {
		if (saving) return;
		saving = true;
		const result = await editTask(current, edit);
		saving = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		problem = '';
		current = result.value;
		text = result.value.text;
		blockedBy = result.value.blockedBy.join(', ');
		onchange?.(result.value);
	}

	function rename() {
		const next = text.trim();
		if (!next || next === current.text) return;
		void save({ text: next });
	}

	/**
	 * Put the card in a workspace, or in none, by rewriting the line's tags.
	 *
	 * One edit: the new tag added and every other `ws/` tag taken off, so the
	 * card never ends up in two workspaces and the note is touched once.
	 */
	function setWorkspace(tag: string) {
		const removeTags = workspaceTags(current).filter((t) => t !== tag);
		const addTags = tag && !current.tags.includes(tag) ? [tag] : [];
		if (!addTags.length && !removeTags.length) return;
		void save({ addTags, removeTags });
	}

	function setBlockers() {
		const ids = blockedBy
			.split(',')
			.map((id) => id.trim())
			.filter(Boolean);
		if (ids.join(',') === current.blockedBy.join(',')) return;
		void save({ blockedBy: ids });
	}

	/** A click that lands on the dialog itself came from the backdrop. */
	function maybeBackdrop(event: MouseEvent) {
		if (event.target === dialog) onclose();
	}
</script>

<dialog
	bind:this={dialog}
	onclose={onclose}
	onclick={maybeBackdrop}
	data-testid="card-drawer"
	aria-label="Card: {displayText(current.text)}"
>
	<div class="inner">
		<header>
			<h2>Card</h2>
			{#if context?.workspace}
				<span class="ws"><span class="dot" style="--dot: {context.workspace.color}"></span>{context.workspace.name}</span>
			{/if}
			<button class="btn ghost" data-testid="drawer-close" onclick={onclose} aria-label="Close">✕</button>
		</header>

		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

		<label class="row">
			<span>Card</span>
			<input
				bind:this={field}
				bind:value={text}
				data-testid="drawer-text"
				aria-label="Card text"
				onblur={rename}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						rename();
					}
				}}
			/>
		</label>

		<div class="grid">
			<label class="row">
				<span>Status</span>
				<select
					data-testid="drawer-status"
					value={current.status}
					onchange={(e) => save({ status: e.currentTarget.value as TaskStatus })}
				>
					{#each STATUSES as status (status.value)}
						<option value={status.value}>{status.label}</option>
					{/each}
				</select>
			</label>

			<label class="row">
				<span>Quadrant</span>
				<select
					data-testid="drawer-quadrant"
					value={current.quadrant === null ? '' : String(current.quadrant)}
					onchange={(e) => save({ quadrant: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
				>
					<option value="">None</option>
					{#each [1, 2, 3, 4] as q (q)}<option value={String(q)}>Q{q}</option>{/each}
				</select>
			</label>

			<label class="row">
				<span>Workspace</span>
				<select
					data-testid="drawer-workspace"
					value={tagged}
					onchange={(e) => setWorkspace(e.currentTarget.value)}
				>
					<option value="">None</option>
					{#each context?.workspaces ?? [] as workspace (workspace.slug)}
						<option value={workspace.tag}>{workspace.name}</option>
					{/each}
				</select>
			</label>

			<label class="row">
				<span>Due</span>
				<input
					type="date"
					data-testid="drawer-due"
					value={current.due ?? ''}
					onchange={(e) => save({ due: e.currentTarget.value || null })}
				/>
			</label>

			<div class="row">
				<span>Pinned</span>
				<button
					class="btn"
					class:primary={pinned}
					data-testid="drawer-pin"
					aria-pressed={pinned}
					onclick={() => save(pinned ? { removeTags: ['pin'] } : { addTags: ['pin'] })}
				>
					{pinned ? 'Pinned' : 'Pin'}
				</button>
			</div>
		</div>

		<label class="row">
			<span>Waiting on</span>
			<input
				bind:value={blockedBy}
				data-testid="drawer-blockedby"
				placeholder="Task ids, comma separated"
				aria-label="Ids this card is waiting on"
				onblur={setBlockers}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						setBlockers();
					}
				}}
			/>
		</label>

		{#if context && context.block.length}
			<div class="context">
				<span class="label">Underneath it, as written</span>
				<pre data-testid="drawer-block">{context.block.join('\n')}</pre>
			</div>
		{/if}

		<footer>
			<code>{current.path}</code>
			<a class="btn" data-testid="drawer-open-note" href={href}>Open note (line {current.line + 1})</a>
		</footer>
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
	.inner { padding: var(--s4) 18px 18px; display: flex; flex-direction: column; gap: 10px; }
	header { display: flex; align-items: center; gap: 10px; }
	h2 { margin: 0; font-size: 15px; }
	.ws { display: inline-flex; align-items: center; gap: 6px; font-size: var(--t12); color: var(--muted); }
	.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--dot); }
	header .btn { margin-left: auto; }

	.row { display: flex; align-items: center; gap: 10px; }
	.row > span { flex: none; width: 82px; font-size: var(--t12); color: var(--muted); }
	.row input,
	.row select {
		flex: 1;
		min-width: 0;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: 6px var(--s2);
		font: inherit;
		font-size: var(--t13);
		background: var(--field);
	}
	.grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s2) 14px; }

	.context .label { font-size: var(--t12); color: var(--muted); }
	pre {
		margin: 4px 0 0;
		background: var(--soft);
		border-radius: var(--r-md);
		padding: var(--s2) 10px;
		font: var(--t12) var(--mono);
		white-space: pre-wrap;
		max-height: 180px;
		overflow: auto;
	}

	footer { display: flex; align-items: center; gap: 10px; }
	footer code { font: var(--t11) var(--mono); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	footer .btn { margin-left: auto; flex: none; }
	.problem { margin: 0; font-size: var(--t12); color: var(--bad); }

	@media (max-width: 720px) {
		.grid { grid-template-columns: 1fr; }
		.row > span { width: 72px; }
	}
</style>
