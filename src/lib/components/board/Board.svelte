<script lang="ts">
	/**
	 * A workspace's board: its columns side by side, its cards in file order.
	 *
	 * The board it is given is the server's reading of `Board.md`. Every
	 * change — a drag, a tick, a card added, a column renamed — is one op sent
	 * with the hash of that reading, and the board that comes back replaces
	 * this one, whether the op was applied, refused or beaten by an edit made
	 * somewhere else. So the screen never shows a guess for longer than one
	 * request, and only one request is ever in flight.
	 *
	 * What an op does to the file is `$lib/server/parse/kanban.ts`'s business;
	 * this component only chooses which op to ask for.
	 */
	import { untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import CardEditor from './CardEditor.svelte';
	import { api } from '$lib/client/api';
	import { boardDrag, clickEndedDrag, startBoardDrag, type BoardDrop } from '$lib/client/board-drag.svelte';
	import { dueLabel, type Board, type BoardCard, type BoardOp } from '$lib/shared/kanban';

	let { board, today }: { board: Board; today: string } = $props();

	let current = $state(untrack(() => board));
	// A fresh load from the server wins over whatever this copy has become.
	$effect(() => {
		current = board;
	});

	let busy = $state(false);
	let problem = $state('');
	/**
	 * The open menu, and where on screen its button is. Drawn outside the
	 * columns, fixed to the viewport, so the sideways scroller cannot clip it.
	 */
	let menu = $state<{ kind: 'card'; line: number } | { kind: 'column'; index: number } | null>(null);
	let menuAt = $state({ top: 0, right: 0 });
	let opened = $state<number | null>(null);
	let adding = $state<number | null>(null);
	let draft = $state('');
	let renaming = $state<number | null>(null);
	let rename = $state('');
	let addingColumn = $state(false);
	let columnDraft = $state('');
	let root: HTMLElement | undefined = $state();

	const openedCard = $derived(opened === null ? null : find(opened));

	function find(line: number): { card: BoardCard; column: number; index: number } | null {
		for (const [c, column] of current.columns.entries()) {
			const index = column.cards.findIndex((card) => card.line === line);
			if (index !== -1) return { card: column.cards[index], column: c, index };
		}
		return null;
	}

	/**
	 * Send one op. `guess` draws the expected result straight away, for a
	 * drag, where waiting for the round trip would look like the card
	 * snapping back; the server's answer replaces it either way.
	 */
	async function run(op: BoardOp, guess?: (board: Board) => void): Promise<boolean> {
		if (busy) return false;
		busy = true;
		problem = '';
		const before = current;
		if (guess) {
			const copy = structuredClone($state.snapshot(current)) as Board;
			guess(copy);
			current = copy;
		}
		// Every answer but a lost connection carries the board as it now is.
		const result = await api<{ board: Board }>('/api/board', { workspace: before.workspace, hash: before.hash, op });
		busy = false;
		if (result.ok) {
			current = result.value.board;
			return true;
		}
		current = result.body.board ?? before;
		problem = result.message;
		return false;
	}

	function move(line: number, target: BoardDrop) {
		const from = find(line);
		if (!from) return;
		menu = null;
		void run({ kind: 'move-card', line, column: target.column, index: target.index }, (b) => {
			const [card] = b.columns[from.column].cards.splice(from.index, 1);
			b.columns[target.column].cards.splice(target.index, 0, card);
		});
	}

	function toggle(card: BoardCard) {
		menu = null;
		void run({ kind: 'toggle-card', line: card.line, done: !card.done }, (b) => {
			for (const column of b.columns) for (const c of column.cards) if (c.line === card.line) c.done = !card.done;
		});
	}

	async function addCard(column: number) {
		const text = draft.trim();
		if (!text) {
			adding = null;
			return;
		}
		if (await run({ kind: 'add-card', column, text })) draft = '';
	}

	async function saveRename(column: number) {
		const title = rename.trim();
		renaming = null;
		if (title && title !== current.columns[column]?.title) await run({ kind: 'rename-column', column, title });
	}

	async function addColumn() {
		const title = columnDraft.trim();
		if (!title) {
			addingColumn = false;
			return;
		}
		if (await run({ kind: 'add-column', title })) {
			columnDraft = '';
			addingColumn = false;
		}
	}

	function columnAction(op: BoardOp) {
		menu = null;
		void run(op);
	}

	/** Open, unless this click is the end of a drag. */
	function open(card: BoardCard) {
		if (clickEndedDrag()) return;
		menu = null;
		opened = card.line;
	}

	function toggleMenu(next: NonNullable<typeof menu>, event: MouseEvent) {
		if (menuIs(next)) {
			menu = null;
			return;
		}
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		menuAt = { top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) };
		menu = next;
	}

	function menuIs(m: NonNullable<typeof menu>): boolean {
		if (!menu || menu.kind !== m.kind) return false;
		return menu.kind === 'card' ? menu.line === (m as { line: number }).line : menu.index === (m as { index: number }).index;
	}

	// A fixed menu would float away from its button once anything scrolls.
	$effect(() => {
		if (!menu) return;
		const close = () => (menu = null);
		window.addEventListener('scroll', close, true);
		window.addEventListener('resize', close);
		return () => {
			window.removeEventListener('scroll', close, true);
			window.removeEventListener('resize', close);
		};
	});

	const menuCard = $derived(menu?.kind === 'card' ? find(menu.line) : null);
	const menuColumn = $derived(menu?.kind === 'column' ? menu.index : null);

	/** Where the drop line goes in a column: before that card's line, `'end'`, or nowhere. */
	function dropBefore(c: number): number | 'end' | null {
		const target = boardDrag.target;
		if (boardDrag.line === null || !target || target.column !== c) return null;
		const others = current.columns[c].cards.filter((card) => card.line !== boardDrag.line);
		return others[target.index]?.line ?? 'end';
	}

	const focus = (el: HTMLElement) => el.focus();
</script>

<svelte:window
	onclick={(e) => {
		if (menu && !(e.target as HTMLElement).closest('[data-menu]')) menu = null;
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape') menu = null;
	}}
/>

<div class="board" data-testid="board" bind:this={root} class:busy aria-busy={busy}>
	{#if problem}<p class="problem" role="status" data-testid="board-problem">{problem}</p>{/if}

	<div class="scroll" data-board-scroll>
		{#each current.columns as column, c (c)}
			{@const line = dropBefore(c)}
			<section class="column" data-column={c} data-testid="board-column" aria-label={column.title} class:target={boardDrag.target?.column === c}>
				<header>
					{#if renaming === c}
						<input
							class="field rename"
							data-testid="column-rename"
							aria-label="Column name"
							bind:value={rename}
							use:focus
							onblur={() => saveRename(c)}
							onkeydown={(e) => {
								if (e.key === 'Enter') saveRename(c);
								if (e.key === 'Escape') {
									// Leaving the field saves it, so put the name back first.
									rename = column.title;
									renaming = null;
								}
							}}
						/>
					{:else}
						<h3 class="caps">
							{column.title}
							<span class="count num">{column.cards.length}{column.limit ? `/${column.limit}` : ''}</span>
						</h3>
					{/if}
					<button
						class="icon-btn"
						data-menu
						data-testid="column-menu"
						aria-label="{column.title} column options"
						aria-haspopup="menu"
						aria-expanded={menuColumn === c}
						onclick={(e) => toggleMenu({ kind: 'column', index: c }, e)}
					><Icon name="more-horizontal" size={16} /></button>
				</header>

				<div class="cards">
					{#each column.cards as card, i (card.line)}
						{#if line === card.line}<div class="drop-line" aria-hidden="true"></div>{/if}
						<!-- The whole card is the drag handle for a mouse; the title button
						     is what a keyboard or a screen reader uses. -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="card"
							class:done={card.done}
							class:lifted={boardDrag.line === card.line}
							data-card={card.line}
							data-testid="board-card"
							onpointerdown={(e) => root && !busy && startBoardDrag(e, { line: card.line, title: card.title, column: c, index: i }, root, (t) => move(card.line, t))}
						>
							<span class="grip" data-grip aria-hidden="true">⠿</span>
							<button
								class="box"
								data-nodrag
								data-testid="card-done"
								aria-pressed={card.done}
								aria-label={card.done ? `Mark "${card.title}" not done` : `Mark "${card.title}" done`}
								disabled={busy}
								onclick={() => toggle(card)}
							>{card.done ? '✓' : ''}</button>
							<div class="body">
								<button class="title" data-testid="card-open" onclick={() => open(card)}>{card.title || 'Untitled'}</button>
								{#if card.due || card.priority || card.labels.length || card.notes}
									<div class="meta">
										{#if card.due}
											<span class="due num" class:overdue={!card.done && card.due < today} data-testid="card-due">{dueLabel(card.due, today)}</span>
										{/if}
										{#if card.priority}<span class="q q{card.priority}">Q{card.priority}</span>{/if}
										{#each card.labels as label (label)}<span class="tag">#{label}</span>{/each}
										{#if card.notes}<span class="notes" title="Has notes"><Icon name="file-text" size={12} label="Has notes" /></span>{/if}
									</div>
								{/if}
							</div>
							<button
								class="icon-btn more"
								data-menu
								data-nodrag
								data-testid="card-menu"
								aria-label="Options for {card.title}"
								aria-haspopup="menu"
								aria-expanded={menuCard?.card.line === card.line}
								onclick={(e) => toggleMenu({ kind: 'card', line: card.line }, e)}
							><Icon name="more-horizontal" size={14} /></button>
						</div>
					{/each}
					{#if line === 'end'}<div class="drop-line" aria-hidden="true"></div>{/if}
				</div>

				{#if adding === c}
					<input
						class="field add-field"
						data-testid="add-card-text"
						aria-label="New card in {column.title}"
						placeholder="Call landlord fri Q1 #legal"
						bind:value={draft}
						use:focus
						onblur={() => {
							if (!draft.trim()) adding = null;
						}}
						onkeydown={(e) => {
							if (e.key === 'Enter') void addCard(c);
							if (e.key === 'Escape') {
								draft = '';
								adding = null;
							}
						}}
					/>
				{:else}
					<button class="add" data-testid="add-card" onclick={() => { draft = ''; adding = c; }}>
						<Icon name="plus" size={14} /> Add card
					</button>
				{/if}
			</section>
		{/each}

		<section class="column new-column">
			{#if addingColumn}
				<input
					class="field"
					data-testid="add-column-text"
					aria-label="New column name"
					placeholder="Column name"
					bind:value={columnDraft}
					use:focus
					onblur={() => {
						if (!columnDraft.trim()) addingColumn = false;
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter') void addColumn();
						if (e.key === 'Escape') addingColumn = false;
					}}
				/>
			{:else}
				<button class="add" data-testid="add-column" onclick={() => (addingColumn = true)}><Icon name="plus" size={14} /> Add column</button>
			{/if}
		</section>
	</div>
</div>

{#if menuCard}
	{@const { card, column: c, index: i } = menuCard}
	<div class="menu" role="menu" data-menu data-testid="card-menu-items" style="top: {menuAt.top}px; right: {menuAt.right}px">
		<button role="menuitem" use:focus onclick={() => open(card)}>Edit</button>
		<button role="menuitem" onclick={() => toggle(card)}>{card.done ? 'Mark not done' : 'Mark done'}</button>
		{#if i > 0}<button role="menuitem" onclick={() => move(card.line, { column: c, index: i - 1 })}>Move up</button>{/if}
		{#if i < current.columns[c].cards.length - 1}<button role="menuitem" onclick={() => move(card.line, { column: c, index: i + 1 })}>Move down</button>{/if}
		{#if current.columns.length > 1}<p class="caps menu-label">Move to…</p>{/if}
		{#each current.columns as other, t (t)}
			{#if t !== c}
				<button role="menuitem" data-testid="move-to" onclick={() => move(card.line, { column: t, index: other.cards.length })}>{other.title}</button>
			{/if}
		{/each}
	</div>
{:else if menuColumn !== null && current.columns[menuColumn]}
	{@const c = menuColumn}
	{@const column = current.columns[c]}
	<div class="menu" role="menu" data-menu data-testid="column-menu-items" style="top: {menuAt.top}px; right: {menuAt.right}px">
		<!-- The menu goes last: `c` and `column` are read from it, and are gone once it closes. -->
		<button role="menuitem" use:focus onclick={() => { rename = column.title; renaming = c; menu = null; }}>Rename</button>
		{#if c > 0}<button role="menuitem" onclick={() => columnAction({ kind: 'move-column', column: c, index: c - 1 })}>Move left</button>{/if}
		{#if c < current.columns.length - 1}<button role="menuitem" onclick={() => columnAction({ kind: 'move-column', column: c, index: c + 1 })}>Move right</button>{/if}
		<button
			role="menuitem"
			class="danger"
			data-testid="column-delete"
			disabled={column.cards.length > 0}
			title={column.cards.length ? 'Move its cards out first' : undefined}
			onclick={() => columnAction({ kind: 'delete-column', column: c })}
		>Delete column</button>
	</div>
{/if}

{#if openedCard}
	<CardEditor
		card={openedCard.card}
		column={openedCard.column}
		columns={current.columns.map((c) => c.title)}
		{busy}
		{problem}
		onsave={(fields) => {
			if (opened !== null) void run({ kind: 'edit-card', line: opened, ...fields });
		}}
		ontoggle={(done) => {
			if (opened !== null) void run({ kind: 'toggle-card', line: opened, done });
		}}
		onmove={async (column) => {
			const at = openedCard;
			if (!at) return;
			const title = at.card.title;
			const index = current.columns[column].cards.length;
			if (await run({ kind: 'move-card', line: at.card.line, column, index })) {
				// The card starts on a new line once moved: follow it there.
				opened = current.columns[column].cards.find((c) => c.title === title)?.line ?? null;
			}
		}}
		ondelete={async () => {
			if (opened !== null && (await run({ kind: 'delete-card', line: opened }))) opened = null;
		}}
		onclose={() => (opened = null)}
	/>
{/if}

{#if boardDrag.line !== null}
	<div class="drag-ghost" style="left: {boardDrag.x + 12}px; top: {boardDrag.y - 10}px">{boardDrag.title}</div>
{/if}

<style>
	/* Sized by the board's own width, not the window's: on a portrait monitor
	   the rail has already taken its share. */
	.board { container-type: inline-size; }
	.busy .card { cursor: progress; }
	.problem { margin: 0 0 var(--s2); }

	.scroll {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(230px, 1fr);
		gap: var(--s4);
		overflow-x: auto;
		padding-bottom: var(--s2);
		align-items: start;
		scrollbar-width: thin;
	}
	.column { display: flex; flex-direction: column; gap: var(--s2); min-width: 0; border-radius: var(--r-lg); }
	.column.target { outline: 2px dashed var(--accent); outline-offset: 4px; }
	.new-column { padding-top: 2px; }

	header { display: flex; align-items: center; gap: var(--s2); min-height: 30px; }
	h3 { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; }
	.count { font-weight: 400; letter-spacing: 0; margin-left: var(--s1); }
	.rename { flex: 1; padding: var(--s1) var(--s2); font-size: var(--t13); }

	.cards { display: flex; flex-direction: column; gap: var(--s2); min-height: var(--s6); }

	.card {
		position: relative;
		display: flex;
		align-items: flex-start;
		gap: var(--s2);
		padding: 10px var(--s3) 10px var(--s2);
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		user-select: none;
		-webkit-user-select: none;
		cursor: grab;
	}
	.card:hover { border-color: #d6cbbb; }
	.card:focus-within { border-color: var(--accent); }
	.card.lifted { opacity: 0.35; }
	.card.done .title { text-decoration: line-through; color: var(--muted); }

	/* The title stretches over the whole card, so a click anywhere opens it;
	   the checkbox, grip and menu sit above that. */
	.title {
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		font-size: var(--t14);
		line-height: 1.4;
		color: var(--text);
		text-align: left;
		cursor: inherit;
		overflow-wrap: anywhere;
	}
	.title::after { content: ''; position: absolute; inset: 0; border-radius: var(--r-md); }
	.title:focus-visible { outline: none; }
	.body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--s1); }
	.grip, .box, .more { position: relative; z-index: 1; }

	.grip {
		flex: none;
		width: var(--s3);
		margin-top: 2px;
		color: var(--muted);
		font-size: var(--t13);
		line-height: 1;
		touch-action: none;
		opacity: 0;
	}
	.card:hover .grip { opacity: 1; }
	.box { margin-top: 2px; }

	.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
	.due { font-size: var(--t12); color: var(--muted); }
	.due.overdue { color: var(--bad); font-weight: 600; }
	.notes { color: var(--muted); display: inline-flex; }

	.more { flex: none; margin: -2px -6px 0 0; opacity: 0; }
	.card:hover .more, .more:focus-visible, .more[aria-expanded='true'] { opacity: 1; }

	.menu {
		position: fixed;
		z-index: 40;
		min-width: 170px;
		display: flex;
		flex-direction: column;
		padding: var(--s1);
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		box-shadow: var(--shadow);
	}
	.menu button {
		border: 0;
		background: none;
		padding: 6px var(--s2);
		border-radius: var(--r-sm);
		font: inherit;
		font-size: var(--t13);
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.menu button:hover:not(:disabled), .menu button:focus-visible { background: var(--soft); outline: none; }
	.menu button:disabled { color: var(--muted); cursor: default; }
	.menu button.danger:not(:disabled) { color: var(--bad); }
	.menu-label { margin: var(--s1) var(--s2) 2px; }

	.drop-line { height: 2px; margin: -5px 0; background: var(--accent); border-radius: 1px; }

	.add {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		border: 0;
		background: none;
		padding: var(--s1) 2px;
		font: inherit;
		font-size: var(--t13);
		color: var(--muted);
		cursor: pointer;
	}
	.add:hover { color: var(--accent); }
	.add-field { padding: 7px var(--s2); font-size: var(--t14); }

	:global(body.board-dragging) { cursor: grabbing; user-select: none; }

	/* There is no hover on a touch screen: the grip and the menu are always
	   there, faint, and the grip is where a finger starts a drag. */
	@media (hover: none) {
		.grip { opacity: 0.6; padding: 0 var(--s1); margin-left: calc(-1 * var(--s1)); }
		.more { opacity: 0.7; }
		.card { cursor: default; }
	}

	/* Too narrow for the columns side by side: one column at a time, most of
	   the width, the next one peeking in, snapping as it scrolls. */
	@container (max-width: 560px) {
		.scroll { grid-auto-columns: 84%; scroll-snap-type: x mandatory; }
		.column { scroll-snap-align: start; }
	}
</style>
