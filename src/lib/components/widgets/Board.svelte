<script lang="ts">
	/**
	 * The kanban board for a workspace.
	 *
	 * Columns come from the server already filled; this component decides
	 * nothing about membership and asks `$lib/shared/board` which column a card
	 * is in, so a card dragged here lands where the server would have put it.
	 *
	 * An edited card is held as a patch over the server's data rather than
	 * copied into local state, the same way the day page does it: copying makes
	 * the first server-rendered paint empty, and deriving means a card moving
	 * between columns falls out of the grouping for free.
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
	import CardDrawer from '../CardDrawer.svelte';
	import Unavailable from './Unavailable.svelte';
	import type { LoadedWidget } from '$lib/shared/widgets';

	/** What a board with nothing behind it looks like, so a failed load renders. */
	const NOTHING: BoardWidget = { workspace: null, columns: [], excluded: 0, candidates: [], deck: '' };

	let { widget, refresh }: { widget: LoadedWidget; refresh?: () => void } = $props();

	const board = $derived((widget.data as BoardWidget | null) ?? NOTHING);
	const columns = $derived<Column[]>(
		board.columns.map(({ key, title, status, tag }) => ({ key, title, status, tag }))
	);

	let patches = $state(new Map<string, Task>());
	// Cards this page just made: one appended to the deck, or one promoted from
	// a checklist line. They are shown at once rather than waiting for the
	// index to catch up with the file that was just written; the next load
	// brings the same card from the server and the key drops the duplicate.
	let mine = $state<Card[]>([]);
	let promoted = $state(new Set<string>());
	let drafts = $state<Record<string, string>>({});
	let problem = $state('');
	let busy = $state('');
	let opened = $state<Task | null>(null);
	let reviewing = $state(false);

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
	const candidates = $derived(
		board.candidates
			.map((note) => ({ ...note, tasks: note.tasks.filter((task) => !promoted.has(cardKey(task))) }))
			.filter((note) => note.tasks.length > 0)
	);
	const showReview = $derived(reviewing || cards.length === 0);

	function applied(task: Task) {
		problem = '';
		const next = new Map(patches);
		next.set(cardKey(task), task);
		patches = next;
	}

	async function move(task: Task, column: Column) {
		// Guarded per card, not globally: moving one card must not swallow the
		// move of another a second later.
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

	/**
	 * Give a checkbox line a quadrant, which by this vault's own convention is
	 * what turns it into work. The user picks which quadrant; nothing is
	 * promoted automatically.
	 */
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

	/** What a card is waiting on, as a tooltip: an id with no task is dangling. */
	const blockerTitle = (card: Card) =>
		card.blockers
			.map((blocker) => (blocker.task ? displayText(blocker.task.text) : `${blocker.id} (no such task)`))
			.join(', ');

	const noteName = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/, '');
	const zoneId = (column: Column) => `board:${board.workspace?.slug ?? 'none'}:${column.key}`;
	const isDragging = (task: Task) => drag.task?.path === task.path && drag.task?.line === task.line;

	/** Register a column as a drop target for the duration it is on screen. */
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
</script>

{#if widget.problem || !widget.data}
	<Unavailable {widget} />
{:else if !board.workspace}
	<p class="empty">A board shows one workspace's cards. Add this widget to a workspace tab.</p>
{:else}
	{#if problem}<p class="problem" data-testid="board-problem" role="alert">{problem}</p>{/if}

	<div class="columns" data-testid="board">
		{#each grouped as group (group.column.key)}
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
										⛔ {card.blockers.length}
									</span>
								{/if}
								<span class="src" title={card.task.path}>{noteName(card.task.path)}</span>
							</div>

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
						</article>
					{/each}
				</div>

				<form class="new" onsubmit={(e) => add(e, group.column)}>
					<input
						data-testid="new-card"
						bind:value={drafts[group.column.key]}
						placeholder="New card"
						aria-label="New card in {group.column.title}"
					/>
					<button class="btn" data-testid="add-card" disabled={!(drafts[group.column.key] ?? '').trim()}>
						Add
					</button>
				</form>
			</section>
		{/each}
	</div>

	{#if cards.length === 0}
		<div class="nothing" data-testid="board-empty">
			<p class="lead">Nothing on this board yet.</p>
			<form class="first" onsubmit={(e) => add(e, columns[0])}>
				<input
					data-testid="first-card"
					bind:value={drafts[columns[0].key]}
					placeholder="First card for {board.workspace.name}…"
					aria-label="First card"
				/>
				<button class="btn primary">Add card</button>
			</form>
			<p class="hint">Appends one line to {board.deck}. Anything written in the workspace's notes shows here too.</p>
		</div>
	{/if}

	{#if board.excluded > 0}
		<p class="excluded" data-testid="excluded">
			{board.excluded} checkbox {board.excluded === 1 ? 'line' : 'lines'} in this workspace's notes
			{board.excluded === 1 ? 'is' : 'are'} not shown: no quadrant, due date, id or workspace tag, so
			{board.excluded === 1 ? 'it reads' : 'they read'} as checklist notation rather than work.
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
			<p class="hint">
				Give a line a quadrant and it becomes a card, by the same convention the rest of your vault uses.
				Nothing is promoted for you.
			</p>
			{#each candidates as note (note.path)}
				<div class="note">
					<a class="src" href="/notes/{note.path.split('/').map(encodeURIComponent).join('/')}">{note.title}</a>
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
				</div>
			{/each}
		</div>
	{/if}

	{#if opened}
		<CardDrawer task={opened} onclose={() => (opened = null)} onchange={applied} />
	{/if}
{/if}

<style>
	.columns {
		display: flex;
		gap: 10px;
		overflow-x: auto;
		padding-bottom: 6px;
		align-items: flex-start;
	}
	.col {
		flex: 0 0 260px;
		background: var(--soft);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 8px;
		min-width: 0;
	}
	.col.over { border-color: var(--accent); background: var(--accent-soft); }
	.col header { display: flex; align-items: center; gap: 6px; margin: 2px 2px 8px; }
	h4 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
	.n { margin-left: auto; font: 11px var(--mono); color: var(--muted); }

	.stack { display: flex; flex-direction: column; gap: 6px; }
	.card {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 7px 8px;
	}
	.card.dragging { opacity: 0.4; }
	.card.saving { opacity: 0.6; }
	.top { display: flex; align-items: baseline; gap: 6px; }
	.grip { color: var(--muted); cursor: grab; touch-action: none; user-select: none; font-size: 12px; line-height: 1; }
	.open {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.open:hover { color: var(--accent); }
	.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 5px; font-size: 11px; color: var(--muted); }
	.due { font-family: var(--mono); }
	.blocked { color: var(--bad); }
	.src { margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }
	.move {
		margin-top: 6px;
		width: 100%;
		font: 11px inherit;
		color: var(--muted);
		border: 1px solid var(--line);
		border-radius: 6px;
		background: #fff;
		padding: 2px 4px;
	}

	.new { display: flex; gap: 4px; margin-top: 8px; }
	.new input {
		flex: 1;
		min-width: 0;
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 5px 7px;
		font: inherit;
		font-size: 12px;
		background: #fff;
	}
	.new .btn { padding: 4px 8px; font-size: 12px; }

	.nothing { margin-top: 14px; text-align: center; padding: 18px 12px; border: 1px dashed var(--line); border-radius: 10px; }
	.lead { margin: 0 0 10px; color: var(--muted); }
	.first { display: flex; gap: 6px; justify-content: center; }
	.first input { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font: inherit; min-width: 240px; }

	.excluded { margin: 12px 0 0; font-size: 12px; color: var(--muted); }
	.link { border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; font: inherit; text-decoration: underline; }

	.review { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; }
	h5 { margin: 0 0 4px; font-size: 13px; }
	.note { margin-top: 10px; }
	.note .src { display: block; font-size: 12px; margin: 0 0 2px; max-width: none; }
	.line { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-top: 1px solid var(--line); font-size: 13px; }
	.line .text { flex: 1; min-width: 0; }
	.qs { display: flex; gap: 3px; flex: none; }
	.qbtn {
		border: 1px solid var(--line);
		background: #fff;
		border-radius: 4px;
		font: 11px/1 var(--mono);
		padding: 3px 4px;
		cursor: pointer;
		color: var(--muted);
	}
	.qbtn:hover:not(:disabled) { color: #fff; }
	.qbtn.q1:hover:not(:disabled) { background: var(--q1); border-color: var(--q1); }
	.qbtn.q2:hover:not(:disabled) { background: var(--q2); border-color: var(--q2); }
	.qbtn.q3:hover:not(:disabled) { background: var(--q3); border-color: var(--q3); }
	.qbtn.q4:hover:not(:disabled) { background: var(--q4); border-color: var(--q4); }

	.problem { margin: 0 0 8px; font-size: 12px; color: var(--bad); }
	.hint { font-size: 12px; color: var(--muted); }

	@media (max-width: 720px) {
		.col { flex: 0 0 82vw; scroll-snap-align: start; }
		.columns { scroll-snap-type: x mandatory; }
		.first input { min-width: 0; flex: 1; }
	}
</style>
