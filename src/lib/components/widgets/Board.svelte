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
	 * horizontally scrolling board is miserable. On a pointer device that
	 * select is held back until the card is hovered or focused, because five
	 * columns of permanently open dropdowns read as a form rather than a board;
	 * on a touch screen, where there is no hover to reveal it and no good drag
	 * either, it stays out. Same control, revealed by whatever the device can
	 * actually do.
	 *
	 * Two more things earn their place by what they remove. A column's add form
	 * is folded behind one ghost button, so four empty columns no longer show
	 * four text inputs. And a Done or Cancelled column with nothing in it is
	 * parked behind a toggle, since the common case is a board whose finished
	 * columns are noise until you want them — which is a preference, so it is
	 * remembered per device rather than asked again every load.
	 */
	import { displayText, type Task } from '$lib/shared/task';
	import { cardKey, columnFor, compareCards, type BoardWidget, type Card, type Column } from '$lib/shared/board';
	import { createCard, moveCard } from '$lib/client/cards';
	import { editTask } from '$lib/client/api';
	import { drag, registerDropZone, startDrag } from '$lib/client/drag.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import CardDrawer from '../CardDrawer.svelte';
	import Unavailable from './Unavailable.svelte';
	import { claimHeaderSlot } from './header-slot.svelte';
	import type { LoadedWidget } from '$lib/shared/widgets';

	/** What a board with nothing behind it looks like, so a failed load renders. */
	const NOTHING: BoardWidget = { workspace: null, columns: [], excluded: 0, candidates: [], deck: '' };

	/** Where the "show the finished columns" preference is kept, per device. */
	const FINISHED_KEY = 'hub:board-finished';

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
	// Which column's add form is open, and which card has pinned its column
	// select open. One of each: two half-typed cards, or a board of open
	// selects, is the noise this layout exists to remove.
	let adding = $state('');
	let revealed = $state('');
	let showFinished = $state(false);
	// The column the phone is looking at, which its pills mirror. Empty until
	// the observer reports one, so the server's first paint highlights nothing
	// rather than guessing wrong.
	let active = $state('');
	let scroller: HTMLDivElement | undefined = $state();
	let more = $state(false);

	claimHeaderSlot(() => headerToggle);

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
	/**
	 * A column whose status says the work is over. Read from the status the
	 * server put on the column rather than from its title, so a workspace that
	 * calls its column "Shipped" and maps it to `done` is treated the same as
	 * one that calls it Done, and one that merely mentions the word is not.
	 */
	const finished = (column: Column) => column.status === 'done' || column.status === 'cancelled';

	/** Finished columns with nothing in them: what the toggle is about. */
	const parked = $derived(grouped.filter((group) => finished(group.column) && group.cards.length === 0).length);
	const shown = $derived(
		grouped.filter((group) => showFinished || group.cards.length > 0 || !finished(group.column))
	);
	const candidates = $derived(
		board.candidates
			.map((note) => ({
				...note,
				// What the server counted but did not send, worked out before the
				// local filter, so promoting a line does not make this jump.
				rest: note.count - note.tasks.length,
				tasks: note.tasks.filter((task) => !promoted.has(cardKey(task)))
			}))
			.filter((note) => note.tasks.length > 0)
	);
	const showReview = $derived(reviewing || cards.length === 0);

	/**
	 * What the board left out, said per note: "414 checklist lines in Manual
	 * Test Plan are not cards". Naming the note is the useful half — a bare
	 * total says nothing about where to look, and in this vault every one of
	 * those lines comes from a single test plan. The note's title rather than
	 * its path, because that is what the review below lists; the path is the
	 * link inside it.
	 */
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

	// Read after mounting, like the rail's own collapsed state: the server has
	// no way to know what this device last chose.
	$effect(() => {
		showFinished = localStorage.getItem(FINISHED_KEY) === '1';
	});

	/**
	 * Keep the right-edge shadow and the phone's active pill in step with the
	 * scroller. Re-runs whenever the visible columns change, because both the
	 * observer's targets and the overflow depend on how many there are.
	 */
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
				// Most of the viewport wins, and ties go to the leftmost column,
				// so a half-and-half scroll position never flickers between two.
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

	/** Bring a column to the left edge of the scroller, for the phone's pills. */
	function jumpTo(key: string) {
		const element = scroller?.querySelector(`[data-column="${key}"]`);
		if (!scroller || !element) return;
		const left = scroller.scrollLeft + element.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
		scroller.scrollTo({ left, behavior: 'smooth' });
		// Set straight away rather than waiting for the observer, so the pill
		// answers the tap even while the scroll is still animating.
		active = key;
	}

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

	/** Take the caret the moment a field is revealed, so one click is enough. */
	function takesFocus(node: HTMLInputElement) {
		node.focus();
	}
</script>

{#if widget.problem || !widget.data}
	<Unavailable {widget} />
{:else if !board.workspace}
	<p class="empty">A board shows one workspace's cards. Add this widget to a workspace tab.</p>
{:else}
	{#if problem}<p class="problem" data-testid="board-problem" role="alert">{problem}</p>{/if}

	<!--
		The toggle sits in the widget's own heading, beside the title; see
		`headerToggle` below. Only the pills are left here, and they are the
		phone's, so on a desktop this row collapses to nothing.
	-->
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

	<!--
		One note at a time. A flat list was four hundred lines of someone's test
		plan with the one note worth looking at buried in it; a disclosure per
		note makes the choice "which note" first and "which line" second, and
		the first note is open so the review still starts somewhere.
	-->
	{#if showReview && candidates.length > 0}
		<div class="review" data-testid="promote">
			<h5>Promote a line to a card</h5>
			<p class="hint">A quadrant is what makes a line a card, and nothing is promoted for you.</p>
			{#each candidates as note, i (note.path)}
				<details class="note" data-testid="candidate-note" open={i === 0}>
					<summary>
						<span class="who">{note.title}</span>
						<span class="n">{note.count}</span>
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

<!--
	Rendered by `Widget.svelte` in this widget's heading, not here. It draws
	nothing when no finished column is parked, which is the common case and
	which is why the claim never has to be withdrawn.
-->
{#snippet headerToggle()}
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
{/snippet}

<style>
	.finished { white-space: nowrap; }
	.chip .n { font-size: var(--t11); }

	/* Pills are the phone's way to change column; a desktop just looks across,
	   so on a desktop this row is not drawn at all and costs no height. */
	.pills { display: none; }

	/* The shadow lives on the wrapper, because a pseudo element on the
	   scroller itself would scroll away with the columns. */
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
		/* Share the row rather than each taking a fixed slice, so four columns
		   fill the widget and six scroll instead of clipping the last. 220px is
		   what a card needs to be readable, not a step on the spacing scale. */
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
	/* A date, so body text with the figures lined up rather than monospace. */
	.due { font-variant-numeric: tabular-nums; }
	.blocked { display: inline-flex; align-items: center; gap: 3px; color: var(--bad); }
	.src { margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px; }

	/* Touch and narrow screens get the select in the flow, under the card:
	   there is no hover to reveal it with and no pleasant drag either. */
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
	.note summary { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: var(--t13); }
	.note .who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.note summary .n { margin-left: auto; font-size: var(--t11); color: var(--muted); }
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

	/* `.problem` is shared, in app.css; this one leads the block below it
	   rather than following one, so it needs the margin on the other side. */
	.problem { margin: 0 0 var(--s2); }
	/* `.hint` is shared, in app.css. */

	/*
	 * A pointer device can reveal things by hovering, so the select moves into
	 * the card's top-right corner and stays out of the way until asked for.
	 * It is taken out with `visibility` rather than `opacity` so it also leaves
	 * the tab order, and it is positioned rather than sized to nothing so
	 * revealing it never reflows the title underneath.
	 */
	@media (hover: hover) {
		/* All the card reserves is the button. The select hangs off it like a
		   menu, over the meta line, which carries no target to steal: putting
		   it beside the button instead would either cover the title or squeeze
		   it to nothing in a 220px column. */
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
		/* One column at a time, paged by swiping; the pills say which. */
		.col { flex: 0 0 82vw; scroll-snap-align: start; }
		.columns { scroll-snap-type: x mandatory; }
		.first input { min-width: 0; flex: 1; }
		/* A pill is a tap target here, so it is as tall as a thumb needs. */
		.pills { display: flex; flex-wrap: nowrap; overflow-x: auto; min-width: 0; margin-bottom: var(--s2); padding-bottom: 2px; }
		.pills .chip { min-height: 40px; }
		/* Back into the flow, always visible: there is no hover here to ask with. */
		.top { padding-right: 0; }
		.actions { position: static; display: flex; margin-top: 5px; }
		.actions .icon-btn { display: none; }
		.move { position: static; flex: 1; width: auto; max-width: none; visibility: visible; box-shadow: none; }
	}
</style>
