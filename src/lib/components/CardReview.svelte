<script lang="ts">
	/**
	 * A flashcard session: one card, reveal, four grades, repeat.
	 *
	 * Holds the queue it was given rather than refetching, so a review works
	 * on a phone with a bad connection: a card that fails to save says so and
	 * stays in the session instead of disappearing.
	 *
	 * Keyboard on a desktop, thumbs on a phone. Space or a tap on the card
	 * reveals; 1 to 4 grade; the buttons are the same four in the same order,
	 * big enough to hit without looking.
	 */
	import { GRADES, outcomes, type Grade } from '$lib/shared/scheduler';
	import { collapseBreadcrumb } from '$lib/client/breadcrumb';
	import { applyShift, gradeCard } from '$lib/client/flashcards';
	import type { Card } from '$lib/shared/flashcards';
	import Icon from '$lib/components/Icon.svelte';

	let {
		cards,
		today,
		onfinish
	}: {
		cards: Card[];
		today: string;
		onfinish?: () => void;
	} = $props();

	let queue = $state<Card[]>([]);
	let started = $state(false);
	let at = $state(0);
	let revealed = $state(false);
	let saving = $state(false);
	let problem = $state('');
	let graded = $state(0);
	let again = $state(0);

	// A session is a snapshot of the queue it was handed: grading must not
	// reshuffle it mid-session. Reseeding when `cards` changes is what makes
	// navigating back to the review page start a fresh session rather than
	// resume yesterday's.
	$effect(() => {
		queue = [...cards];
		at = 0;
		revealed = false;
		graded = 0;
		again = 0;
		problem = '';
		started = true;
	});

	const card = $derived(queue[at] ?? null);
	const done = $derived(started && card === null);
	/** Total attempts left, so a lapsed card coming round again is counted. */
	const left = $derived(queue.length - at);

	const LABEL: Record<Grade, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };

	/** What each button will do, shown on it, from the arithmetic the server grades with. */
	const previews = $derived.by(() => {
		if (!card) return [];
		const next = outcomes(card.schedule, today);
		return GRADES.map((g) => ({ grade: g, label: LABEL[g], when: next[g].label }));
	});

	async function grade(choice: Grade) {
		if (!card || saving) return;
		saving = true;
		problem = '';
		const result = await gradeCard(card, choice);
		saving = false;

		if (!result.ok) {
			problem = result.message;
			return;
		}

		graded++;
		if (choice === 'again') again++;
		const rest = applyShift(queue, result.value.shift);
		const next = result.value.card;
		if (next.schedule && next.schedule.due <= today) {
			// A learning step is minutes, so the card is due again today: it
			// comes back at the end of this session.
			queue = [...rest.slice(0, at), ...rest.slice(at + 1), next];
		} else {
			queue = rest;
			at++;
		}
		revealed = false;
		if (at >= queue.length) onfinish?.();
	}

	function key(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === ' ' || event.key === 'Enter') {
			event.preventDefault();
			if (!revealed) revealed = true;
			return;
		}
		const n = Number(event.key);
		if (revealed && n >= 1 && n <= 4) {
			event.preventDefault();
			void grade(GRADES[n - 1]);
		}
	}
</script>

<svelte:window onkeydown={key} />

{#if card}
	<div class="session" data-testid="card-review">
		<div class="progress" aria-label="{left} left">
			<i style="width: {(graded / Math.max(1, graded + left)) * 100}%"></i>
		</div>
		<p class="meta">
			<span data-testid="card-left">{left} left</span>
			<span class="ctx" title={card.path}>{collapseBreadcrumb(card.context)}</span>
		</p>

		<button class="face" data-testid="card" onclick={() => (revealed = true)} aria-expanded={revealed}>
			<div class="question" data-testid="card-question">{card.question}</div>
			{#if revealed}
				<hr />
				<div class="answer" data-testid="card-answer">{card.answer}</div>
			{:else}
				<p class="reveal">Tap, or press space, to reveal</p>
			{/if}
		</button>

		{#if revealed}
			<div class="grades" data-testid="grades">
				{#each previews as preview, i (preview.grade)}
					<button
						class="grade {preview.grade}"
						data-testid="grade-{preview.grade}"
						disabled={saving}
						onclick={() => grade(preview.grade)}
					>
						<b>{preview.label}</b>
						<small>{preview.when}</small>
						<em>{i + 1}</em>
					</button>
				{/each}
			</div>
		{/if}

		{#if problem}<p class="problem" data-testid="card-problem">{problem}</p>{/if}
		<p class="where"><a href="/notes/{card.path}">Open the note</a></p>
	</div>
{:else if done}
	<div class="empty big" data-testid="review-done">
		<p class="tick"><Icon name="check" size={40} /></p>
		<h2>Done for today</h2>
		<p class="muted">{graded} {graded === 1 ? 'answer' : 'answers'}{again > 0 ? `, ${again} to see again` : ''}.</p>
		<a class="btn primary" href="/flashcards">Back to flashcards</a>
	</div>
{/if}

<style>
	.session { max-width: 680px; margin: 0 auto; }
	.progress { height: 4px; border-radius: 2px; background: var(--soft); overflow: hidden; }
	.progress i { display: block; height: 100%; background: var(--accent); transition: width 0.2s; }
	.meta { display: flex; gap: 10px; font-size: var(--t12); color: var(--muted); margin: var(--s2) 0 var(--s3); }
	.ctx { margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/*
	 * Named `.face` rather than `.card`, and the question and answer
	 * `.question`/`.answer` rather than `.q`/`.a`: those shorter names collide
	 * with `app.css`'s own `.card` (the boxed-group panel) and `.q1`-`.q4`
	 * quadrant badges — same class, different rule, and Svelte's scoping does
	 * not raise a plain class selector's specificity, so whichever stylesheet
	 * loaded second used to win.
	 */
	.face {
		display: block;
		width: 100%;
		text-align: left;
		font: inherit;
		color: inherit;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: var(--s5);
		min-height: 190px;
		cursor: pointer;
	}
	.question { font-size: 19px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
	.answer { font-size: var(--t16); line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
	hr { border: 0; border-top: 1px solid var(--line); margin: var(--s4) 0; }
	.reveal { margin: 18px 0 0; color: var(--muted); font-size: var(--t13); }

	.grades { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s2); margin-top: 14px; }
	.grade {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: var(--s3) 6px;
		border: 1px solid var(--line);
		border-radius: var(--r);
		background: var(--field);
		font: inherit;
		cursor: pointer;
	}
	.grade:hover:not(:disabled) { background: var(--soft); }
	.grade:disabled { opacity: 0.5; cursor: default; }
	.grade b { font-size: var(--t14); }
	/* What the grade would do next: an interval, so body text with the figures
	   lined up. The key that answers it stays monospaced, as keys do. */
	.grade small { font-size: var(--t11); font-variant-numeric: tabular-nums; color: var(--muted); }
	.grade em { position: absolute; top: var(--s1); right: 6px; font: 10px var(--mono); font-style: normal; color: var(--muted); }
	.again { border-color: #e9c3c3; }
	.easy { border-color: #bfe3cb; }

	.where { font-size: var(--t12); margin-top: 14px; }

	/*
	 * The phone's whole session is exactly the space `+layout.svelte` leaves
	 * under the shell header and its tab bar: `.session` is a flex column
	 * filling that (see `.page` in the review pages under `study/`, which grant
	 * it `flex: 1`), the card takes what is left after the fixed-size chrome
	 * around it and scrolls its own overflow, and the grades therefore end up
	 * sitting on the floor of that space without either element needing to
	 * know the header's height.
	 */
	@media (max-width: 720px) {
		.session { display: flex; flex-direction: column; min-height: 0; }
		.face { padding: 18px; flex: 1; min-height: 0; overflow-y: auto; }
		.question { font-size: 17px; }
		.grades { flex: none; gap: 6px; }
		.grade { padding: 14px 2px; min-height: 56px; }
		.grade b { font-size: var(--t13); }
		/* A keyboard is not how a phone answers, so its hints are noise. */
		.grade em { display: none; }
	}
</style>
