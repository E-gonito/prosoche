<script lang="ts">
	/**
	 * One widget in its frame.
	 *
	 * The frame is here rather than in each widget so every card on every tab
	 * has the same heading, padding and empty state, and a widget only has to
	 * render its own contents.
	 */
	import Board from './Board.svelte';
	import Notes from './Notes.svelte';
	import Blocked from './Blocked.svelte';
	import Pinned from './Pinned.svelte';
	import Inbox from './Inbox.svelte';
	import People from './People.svelte';
	import Time from './Time.svelte';
	import Insights from './Insights.svelte';
	import Habits from './Habits.svelte';
	import CurrentlyLearning from './CurrentlyLearning.svelte';
	import Queue from './Queue.svelte';
	import TopicMap from './TopicMap.svelte';
	import FlashcardsDue from './FlashcardsDue.svelte';
	import Timesheet from './Timesheet.svelte';
	import GitHub from './GitHub.svelte';
	import Linear from './Linear.svelte';
	import Unavailable from './Unavailable.svelte';
	import type { LoadedWidget } from '$lib/shared/widgets';
	import type { Snippet } from 'svelte';

	let {
		widget,
		refresh,
		right
	}: {
		widget: LoadedWidget;
		refresh?: () => void;
		/** A count or a single action, right of the title. Never prose. */
		right?: Snippet;
	} = $props();
</script>

<section class="widget" class:wide={widget.span === 2} data-widget={widget.name}>
	<h3>
		<span class="title">{widget.title}</span>
		{#if right}<span class="right">{@render right()}</span>{/if}
	</h3>
	<div class="body">
		{#if widget.problem}
			<Unavailable {widget} />
		{:else if widget.name === 'board'}
			<Board {widget} {refresh} />
		{:else if widget.name === 'notes'}
			<Notes {widget} {refresh} />
		{:else if widget.name === 'blocked'}
			<Blocked {widget} {refresh} />
		{:else if widget.name === 'pinned'}
			<Pinned {widget} {refresh} />
		{:else if widget.name === 'inbox'}
			<Inbox {widget} {refresh} />
		{:else if widget.name === 'people'}
			<People {widget} {refresh} />
		{:else if widget.name === 'time'}
			<Time {widget} {refresh} />
		{:else if widget.name === 'insights'}
			<Insights {widget} {refresh} />
		{:else if widget.name === 'habits'}
			<Habits {widget} {refresh} />
		{:else if widget.name === 'currently-learning'}
			<CurrentlyLearning {widget} {refresh} />
		{:else if widget.name === 'queue'}
			<Queue {widget} {refresh} />
		{:else if widget.name === 'topic-map'}
			<TopicMap {widget} {refresh} />
		{:else if widget.name === 'flashcards-due'}
			<FlashcardsDue {widget} {refresh} />
		{:else if widget.name === 'timesheet'}
			<Timesheet {widget} {refresh} />
		{:else if widget.name === 'github'}
			<GitHub {widget} {refresh} />
		{:else if widget.name === 'linear'}
			<Linear {widget} {refresh} />
		{:else}
			<Unavailable {widget} />
		{/if}
	</div>
</section>

<style>
	.widget {
		/* One card is half the row, on the twelve-column grid in app.css. */
		grid-column: span 6;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 12px 14px 14px;
		min-width: 0;
	}
	.wide { grid-column: span 12; }
	h3 {
		margin: 0 0 10px;
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: var(--muted);
	}
	.title { flex: 1; min-width: 0; }
	.right { flex: none; font-weight: 400; text-transform: none; letter-spacing: 0; }
	.body { min-width: 0; }

	/* Too narrow for two cards side by side: every widget takes the row. */
	@media (max-width: 960px) {
		.widget { grid-column: span 12; }
	}
</style>
