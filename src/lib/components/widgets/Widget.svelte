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

	let { widget, refresh }: { widget: LoadedWidget; refresh?: () => void } = $props();
</script>

<section class="widget" class:wide={widget.span === 2} data-widget={widget.name}>
	<h3>{widget.title}</h3>
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
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 12px 14px 14px;
		min-width: 0;
	}
	.wide { grid-column: 1 / -1; }
	h3 {
		margin: 0 0 10px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: var(--muted);
	}
	.body { min-width: 0; }
</style>
