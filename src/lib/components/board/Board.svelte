<script lang="ts">
	/**
	 * The kanban board for a workspace, on its own `Tasks` tab.
	 *
	 * Adapted from the old widget catalogue's `Board.svelte`: the thinking is
	 * unchanged (`$lib/shared/board`, `$lib/client/cards`, `$lib/server/board`
	 * stay the one place each of those questions is answered), but this copy
	 * owns its own heading and "show finished" toggle rather than reaching for
	 * a widget frame's header slot, since the Tasks page is not a grid of
	 * widgets — it is one board.
	 *
	 * Columns come from the server already filled; this component decides
	 * nothing about membership and asks `$lib/shared/board` which column a card
	 * is in, so a card dragged here lands where the server would have put it.
	 *
	 * Dragging is never the only way. Every card carries a column select, which
	 * works from the keyboard and on a phone where a long drag across a
	 * horizontally scrolling board is miserable.
	 */
	import { displayText, type Task } from '$lib/shared/task';
	import { cardKey, columnFor, compareCards, type BoardWidget, type Card, type Column } from '$lib/shared/board';
	import { createCard, moveCard } from '$lib/client/cards';
	import { editTask } from '$lib/client/api';
	import { drag, registerDropZone, startDrag } from '$lib/client/drag.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import CardDrawer from '$lib/components/CardDrawer.svelte';

	/** Where the "show the finished columns" preference is kept, per device. */
	const FINISHED_KEY = 'hub:board-finished';

	let { board, refresh }: { board: BoardWidget; refresh?: () => void } = $props();

	const columns = $derived<Column[]>(
		board.columns.map(({ key, title, status, tag }) => ({ key, title, status, tag }))
	);

	let patches = $state(new Map<string, Task>());
	// Cards this page just made: one appended to the deck, or one promoted from
	// a checklist line. Shown at once rather than waiting for the index to
	// catch up with the file that was just written.
	let mine = $state<Card[]>([]);
	let promoted = $state(new Set<string>());
	let drafts = $state<Record<string, string>>({});
	let problem = $state('');
	let busy = $state('');
	let opened = $state<Task | null>(null);
	let reviewing = $state(false);
	let adding = $state('');
	let revealed = $state('');
	let showFinished = $state(false);
	let active = $state('');
	let scroller: HTMLDivElement | undefined = $state();
	let more = $state(false);

	const cards = $derived.by(() => {
		const fromServer = board.columns.flatMap((column) => column.cards);
		const known = new Set(fromServer.map((card) => cardKey(card.task)));
		return [...fromServer, ...mine.filter((card) => !known.has(cardKey(card.task)))].map((card) => {
			const patched = patches.get(cardKey(card.task));
			return patched ? { ...card, task: patched } : card;
		});
	});
	const grouped = $derived(
		columns.map((column) => ({
			column,
			cards: cards.filter((card) => columnFor(card.task, columns).key === column.key).sort(compareCards)
		}))
	);
	const finished = (column: Column) => column.status === 'done' || column.status === 'cancelled';
	const parked = $derived(grouped.filter((group) => finished(group.column) && group.cards.length === 0).length);
	const shown = $derived(
		grouped.filter((group) => showFinished || group.cards.length > 0 || !finished(group.column))
	);
	const candidates = $derived(
		board.candidates
			.map((note) => ({
				...note,
				rest: note.count - note.tasks.length,
				tasks: note.tasks.filter((task) => !promoted.has(cardKey(task)))
			}))
			.filter((note) => note.tasks.length > 0)
	);
	const showReview = $derived(reviewing || cards.length === 0);

	const excludedSays = $derived.by(() => {
		const notes = board.candidates;
		if (notes.length === 0) return `${board.excluded} checklist lines are not cards.`;
		if (notes.length === 1) {
			const [only] = notes;
			return only.count === 1
				? `1 checklist line in ${only.title} is not a card.`
				: `${only.count} checklist lines in ${only.title} are not cards.`;
		}
		const named = notes.slice(0, 3).map((note) => `${note.count} in ${note.title}`);
		const rest = notes.length - named.length;
		if (rest > 0) named.push(`and ${rest} more ${rest === 1 ? 'note' : 'notes'}`);
		return `${board.excluded} checklist lines are not cards: ${named.join(', ')}.`;
	});

	$effect(() => {
		showFinished = localStorage.getItem(FINISHED_KEY) === '1';
	});

	$effect(() => {
		const root = scroller;
		const groups = shown;
		if (!root) return;

		const measure = () => {
			more = root.scrollLeft + root.clientWidth < root.scrollWidth - 1;
		};
		measure();

		const ratios = new Map<string, number>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					ratios.set((entry.target as HTMLElement).dataset.column ?? '', entry.intersectionRatio);
				}
				let best = '';
				let widest = 0;
				for (const group of groups) {
					const ratio = ratios.get(group.column.key) ?? 0;
					if (ratio > widest) {
						widest = ratio;
						best = group.column.key;
					}
				}
				if (best) active = best;
			},
			{ root, threshold: [0, 0.25, 0.5, 0.75, 1] }
		);
		for (const group of groups) {
			const element = root.querySelector(`[data-column="${group.column.key}"]`);
			if (element) observer.observe(element);
		}

		const resize = new ResizeObserver(measure);
		resize.observe(root);
		root.addEventListener('scroll', measure, { passive: true });
		return () => {
			observer.disconnect();
			resize.disconnect();
			root.removeEventListener('scroll', measure);
		};
	});

	function toggleFinished() {
		showFinished = !showFinished;
		localStorage.setItem(FINISHED_KEY, showFinished ? '1' : '0');
	}

	function jumpTo(key: string) {
		const element = scroller?.querySelector(`[data-column="${key}"]`);
		if (!scroller || !element) return;
		const left = scroller.scrollLeft + element.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
		scroller.scrollTo({ left, behavior: 'smooth' });
		active = key;
	}

	function applied(task: Task) {
		problem = '';
		const next = new Map(patches);
		next.set(cardKey(task), task);
		patches = next;
	}

	async function move(task: Task, column: Column) {
		if (busy === cardKey(task)) return;
		busy = cardKey(task);
		const result = await moveCard(task, column, columns);
		busy = '';
		if (result.ok) applied(result.value);
		else fail(result.message);
	}

	async function add(event: Event, column: Column) {
		event.preventDefault();
		const text = (drafts[column.key] ?? '').trim();
		if (!text || !board.workspace) return;
		busy = `new:${column.key}`;
		const result = await createCard({ workspace: board.workspace.slug, text, column: column.key });
		busy = '';
		if (!result.ok) return fail(result.message);
		drafts[column.key] = '';
		mine = [...mine, { task: result.value, blockers: [] }];
		refresh?.();
	}

	async function promote(task: Task, quadrant: number) {
		busy = cardKey(task);
		const result = await editTask(task, { quadrant });
		busy = '';
		if (!result.ok) return fail(result.message);
		promoted = new Set(promoted).add(cardKey(task));
		mine = [...mine, { task: result.value, blockers: [] }];
		refresh?.();
	}

	function fail(message: string) {
		problem = message;
	}

	const blockerTitle = (card: Card) =>
		card.blockers
			.map((blocker) => (blocker.task ? displayText(blocker.task.text) : `${blocker.id} (no such task)`))
			.join(', ');

	const noteName = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/, '');
	const zoneId = (column: Column) => `board:${board.workspace?.slug ?? 'none'}:${column.key}`;
	const isDragging = (task: Task) => drag.task?.path === task.path && drag.task?.line === task.line;

	function dropColumn(element: HTMLElement, column: Column) {
		let off = registerDropZone({ id: zoneId(column), element, drop: (task) => void move(task, column) });
		return {
			update(next: Column) {
				off();
				off = registerDropZone({ id: zoneId(next), element, drop: (task) => void move(task, next) });
			},
			destroy: () => off()
		};
	}

	function takesFocus(node: HTMLInputElement) {
		node.focus();
	}
</script>

{#if !board.workspace}
	<p class="empty">This workspace has no board yet.</p>
{:else}
	<div class="head">
		{#if parked > 0}
			<button
				class="btn ghost small finished"
				data-testid="show-finished"
				aria-pressed={showFinished}
				onclick={toggleFinished}
			>
				{showFinished ? 'Hide finished' : `Show finished (${parked})`}
			</button>
		{/if}
	</div>

	{#if problem}<p class="problem" data-testid="board-problem" role="alert">{problem}</p>{/if}

	<div class="chips pills" role="group" data-testid="column-pills" aria-label="Jump to a column">
		{#each shown as group (group.column.key)}
			<button
				class="chip"
				class:on={active === group.column.key}
				data-testid="column-pill"
				data-pill={group.column.key}
				aria-current={active === group.column.key ? 'true' : undefined}
				onclick={() => jumpTo(group.column.key)}
			>
				{group.column.title}<span class="n num">{group.cards.length}</span>
			</button>
		{/each}
	</div>

	<div class="deck" class:more data-testid="board-deck" data-more={more}>
		<div class="columns" bind:this={scroller} data-testid="board">
			{#each shown as group (group.column.key)}
				<section
					class="col"
					class:over={drag.zone === zoneId(group.column)}
					data-testid="column"
					data-column={group.column.key}
					use:dropColumn={group.column}
				>
					<header>
						<h4>{group.column.title}</h4>
						<span class="n">{group.cards.length}</span>
					</header>

					<div class="stack">
						{#each group.cards as card (cardKey(card.task))}
							<article
								class="card"
								class:dragging={isDragging(card.task)}
								class:saving={busy === cardKey(card.task)}
								class:revealed={revealed === cardKey(card.task)}
								data-testid="card"
								data-key={cardKey(card.task)}
							>
								<div class="top">
									<span
										class="grip"
										data-testid="card-grip"
										role="button"
										tabindex="-1"
										aria-label="Drag {displayText(card.task.text)} to another column"
										title="Drag to another column"
										onpointerdown={(e) => startDrag(card.task, e)}
									>⠿</span>
									{#if card.task.quadrant}<span class="q q{card.task.quadrant}">Q{card.task.quadrant}</span>{/if}
									<button class="open" data-testid="open-card" onclick={() => (opened = card.task)}>
										{displayText(card.task.text)}
									</button>
								</div>

								<div class="meta">
									{#if card.task.due}<span class="due" data-testid="card-due">Due {card.task.due}</span>{/if}
									{#if card.blockers.length}
										<span class="blocked" data-testid="card-blocked" title={blockerTitle(card)}>
											<Icon name="ban" size={11} />{card.blockers.length}
										</span>
									{/if}
									<span class="src" title={card.task.path}>{noteName(card.task.path)}</span>
								</div>

								<div class="actions">
									<button
										class="icon-btn"
										data-testid="card-more"
										aria-expanded={revealed === cardKey(card.task)}
										aria-label="Column picker for {displayText(card.task.text)}"
										title="Move to another column"
										onclick={() => (revealed = revealed === cardKey(card.task) ? '' : cardKey(card.task))}
									>
										<Icon name="more-horizontal" size={14} />
									</button>
									<select
										class="move"
										data-testid="move-card"
										aria-label="Column for {displayText(card.task.text)}"
										value={group.column.key}
										onchange={(e) => {
											const next = columns.find((c) => c.key === e.currentTarget.value);
											if (next) void move(card.task, next);
										}}
									>
										{#each columns as column (column.key)}
											<option value={column.key}>{column.title}</option>
										{/each}
									</select>
								</div>
							</article>
						{/each}
					</div>

					{#if adding === group.column.key}
						<form class="new" onsubmit={(e) => add(e, group.column)}>
							<input
								use:takesFocus
								data-testid="new-card"
								bind:value={drafts[group.column.key]}
								placeholder="New card"
								aria-label="New card in {group.column.title}"
								onkeydown={(e) => {
									if (e.key === 'Escape') adding = '';
								}}
							/>
							<button class="btn" data-testid="add-card" disabled={!(drafts[group.column.key] ?? '').trim()}>
								Add
							</button>
							<button
								type="button"
								class="icon-btn"
								data-testid="add-card-cancel"
								aria-label="Cancel"
								onclick={() => (adding = '')}
							>
								<Icon name="x" size={13} />
							</button>
						</form>
					{:else}
						<button
							class="addopen"
							data-testid="add-card-open"
							aria-label="Add a card to {group.column.title}"
							onclick={() => (adding = group.column.key)}
						>
							<Icon name="plus" size={13} />Add card
						</button>
					{/if}
				</section>
			{/each}
		</div>
	</div>

	{#if cards.length === 0}
		<div class="nothing" data-testid="board-empty">
			<p class="lead">No cards yet. Add one and it starts {board.deck}.</p>
			<form class="first" onsubmit={(e) => add(e, columns[0])}>
				<input
					data-testid="first-card"
					bind:value={drafts[columns[0].key]}
					placeholder="First card for {board.workspace.name}…"
					aria-label="First card"
				/>
				<button class="btn primary">Add card</button>
			</form>
			<p class="hint">Every checkbox in that note is a card, with or without a quadrant.</p>
		</div>
	{/if}

	{#if board.excluded > 0}
		<p class="excluded" data-testid="excluded">
			{excludedSays}
			{#if !showReview}
				<button class="link" data-testid="review-excluded" onclick={() => (reviewing = true)}>
					Review {board.excluded === 1 ? 'it' : 'them'}
				</button>
			{/if}
		</p>
	{/if}

	{#if showReview && candidates.length > 0}
		<div class="review" data-testid="promote">
			<h5>Promote a line to a card</h5>
			<p class="hint">A quadrant is what makes a line a card, and nothing is promoted for you.</p>
			{#each candidates as note, i (note.path)}
				<details class="note" data-testid="candidate-note" open={i === 0}>
					<summary>
						{note.title} <span class="n">{note.count} {note.count === 1 ? 'line' : 'lines'}</span>
					</summary>
					<a class="src" href="/notes/{note.path.split('/').map(encodeURIComponent).join('/')}">{note.path}</a>
					{#each note.tasks as task (cardKey(task))}
						<div class="line" data-testid="candidate">
							<span class="text">{displayText(task.text)}</span>
							<span class="qs">
								{#each [1, 2, 3, 4] as q (q)}
									<button
										class="qbtn q{q}"
										data-testid="promote-q{q}"
										disabled={busy === cardKey(task)}
										title="Make this a Q{q} card"
										aria-label="Make {displayText(task.text)} a Q{q} card"
										onclick={() => promote(task, q)}
									>Q{q}</button>
								{/each}
							</span>
						</div>
					{/each}
					{#if note.rest > 0}
						<p class="hint">and {note.rest} more in this note; open it to see them all.</p>
					{/if}
				</details>
			{/each}
		</div>
	{/if}

	{#if opened}
		<CardDrawer task={opened} onclose={() => (opened = null)} onchange={applied} />
	{/if}
{/if}

<style>
	.empty { color: var(--muted); }
	.head { display: flex; justify-content: flex-end; min-height: 1px; }
	.finished { white-space: nowrap; }
	.chip .n { font-size: var(--t11); }

	.pills { display: none; }

	.deck { position: relative; min-width: 0; }
	.deck::after {
		content: '';
		position: absolute;
		top: 0;
		right: 0;
		bottom: 6px;
		width: 28px;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.15s;
		background: linear-gradient(to right, rgba(255, 255, 255, 0), var(--panel));
	}
	.deck.more::after { opacity: 1; }

	.columns {
		display: flex;
		gap: 10px;
		overflow-x: auto;
		padding-bottom: 6px;
		align-items: flex-start;
	}
	.col {
		flex: 1 1 220px;
		min-width: 220px;
		background: var(--soft);
		border: 1px solid var(--line);
		border-radius: var(--r);
		padding: 7px;
	}
	.col.over { border-color: var(--accent); background: var(--accent-soft); }
	.col header { display: flex; align-items: center; gap: 6px; margin: 2px 2px 7px; }
	h4 { margin: 0; font-size: var(--t12); text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
	.col header .n { margin-left: auto; font-size: var(--t11); color: var(--muted); }

	.stack { display: flex; flex-direction: column; gap: 5px; }
	.card {
		position: relative;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: 5px 7px 6px;
	}
	.card.dragging { opacity: 0.4; }
	.card.saving { opacity: 0.6; }
	.top { display: flex; align-items: baseline; gap: 6px; }
	.grip { color: var(--muted); cursor: grab; touch-action: none; user-select: none; font-size: var(--t12); line-height: 1; }
	.open {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		font-size: var(--t13);
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.open:hover { color: var(--accent); }
	.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 3px; font-size: var(--t11); color: var(--muted); }
	.due { font-variant-numeric: tabular-nums; }
	.blocked { display: inline-flex; align-items: center; gap: 3px; color: var(--bad); }
	.src { margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px; }

	.actions { display: flex; align-items: center; gap: var(--s1); margin-top: 5px; }
	.actions .icon-btn { display: none; }
	.move {
		flex: 1;
		min-width: 0;
		font: var(--t11) inherit;
		color: var(--muted);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		background: var(--field);
		padding: 2px var(--s1);
	}

	.addopen {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		width: 100%;
		min-height: var(--s6);
		margin-top: 7px;
		border: 1px dashed var(--line);
		border-radius: var(--r-md);
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: var(--t12);
		cursor: pointer;
	}
	.addopen:hover { background: var(--panel); color: var(--accent); border-color: var(--accent); }

	.new { display: flex; gap: var(--s1); margin-top: 7px; }
	.new input {
		flex: 1;
		min-width: 0;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		padding: 5px 7px;
		font: inherit;
		font-size: var(--t12);
		background: var(--field);
	}
	.new .btn { padding: var(--s1) var(--s2); font-size: var(--t12); flex: none; }
	.new .icon-btn { flex: none; }

	.nothing { margin-top: 14px; text-align: center; padding: 18px var(--s3); border: 1px dashed var(--line); border-radius: var(--r); }
	.lead { margin: 0 0 10px; color: var(--muted); }
	.first { display: flex; gap: 6px; justify-content: center; }
	.first input { border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--s2) 10px; font: inherit; background: var(--field); min-width: 240px; }

	.excluded { margin: var(--s3) 0 0; font-size: var(--t12); color: var(--muted); }
	.link { border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; font: inherit; text-decoration: underline; }

	.review { margin-top: var(--s3); border-top: 1px solid var(--line); padding-top: 10px; }
	h5 { margin: 0 0 var(--s1); font-size: var(--t13); }
	.note { margin-top: 10px; }
	.note summary { cursor: pointer; font-size: var(--t13); }
	.note summary .n { font-size: var(--t11); color: var(--muted); }
	.note .src { display: block; font-size: var(--t12); margin: 2px 0; max-width: none; }
	.line { display: flex; align-items: center; gap: var(--s2); padding: var(--s1) 0; border-top: 1px solid var(--line); font-size: var(--t13); }
	.line .text { flex: 1; min-width: 0; }
	.qs { display: flex; gap: 3px; flex: none; }
	.qbtn {
		border: 1px solid var(--line);
		background: var(--field);
		border-radius: 4px;
		font: var(--t11)/1 var(--mono);
		padding: 3px var(--s1);
		cursor: pointer;
		color: var(--muted);
	}
	.qbtn:hover:not(:disabled) { color: #fff; }
	.qbtn.q1:hover:not(:disabled) { background: var(--q1); border-color: var(--q1); }
	.qbtn.q2:hover:not(:disabled) { background: var(--q2); border-color: var(--q2); }
	.qbtn.q3:hover:not(:disabled) { background: var(--q3); border-color: var(--q3); }
	.qbtn.q4:hover:not(:disabled) { background: var(--q4); border-color: var(--q4); }

	.problem { margin: 0 0 var(--s2); }

	@media (hover: hover) {
		.top { padding-right: 22px; }
		.actions { position: absolute; top: 3px; right: var(--s1); display: block; margin-top: 0; }
		.actions .icon-btn { display: inline-flex; opacity: 0.4; }
		.card:hover .actions .icon-btn,
		.card:focus-within .actions .icon-btn { opacity: 1; }
		.move {
			position: absolute;
			top: 21px;
			right: 0;
			z-index: 2;
			width: max-content;
			max-width: 150px;
			visibility: hidden;
			background: var(--panel);
			box-shadow: 0 2px 8px rgba(31, 35, 40, 0.18);
		}
		.card:hover .move,
		.card:focus-within .move,
		.card.revealed .move { visibility: visible; }
	}

	@media (max-width: 720px) {
		.col { flex: 0 0 82vw; scroll-snap-align: start; }
		.columns { scroll-snap-type: x mandatory; }
		.first input { min-width: 0; flex: 1; }
		.pills { display: flex; flex-wrap: nowrap; overflow-x: auto; min-width: 0; margin-bottom: var(--s2); padding-bottom: 2px; }
		.pills .chip { min-height: 40px; }
		.top { padding-right: 0; }
		.actions { position: static; display: flex; margin-top: 5px; }
		.actions .icon-btn { display: none; }
		.move { position: static; flex: 1; width: auto; max-width: none; visibility: visible; box-shadow: none; }
	}
</style>
