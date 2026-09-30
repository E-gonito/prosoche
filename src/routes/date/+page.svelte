<script lang="ts">
	/**
	 * Log: a day stepper and four big counters, exactly the artifact's shape,
	 * warmed to our tokens. Stepping the day re-loads it from the server (a
	 * plain link, so it works with no JavaScript too); editing a counter is
	 * local until Save writes it in one request.
	 *
	 * Under it, "Sent a like": a name and a guess that she replies, which
	 * adds her to People at the `liked` stage straight away, on its own
	 * request. It leaves the counters alone; "Likes sent" is still tapped.
	 */
	import { api } from '$lib/client/api';
	import { goto } from '$app/navigation';
	import { relativeDay } from '$lib/shared/links';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	interface Counts {
		sent: number;
		matches: number;
		type: number;
		received: number;
	}

	const COUNTERS: Array<{ key: keyof Counts; dot: string; title: string; hint: string }> = [
		{ key: 'sent', dot: 'sent', title: 'Likes sent', hint: 'Outgoing likes you sent' },
		{ key: 'matches', dot: 'matches', title: 'Matches', hint: 'From your likes, whenever they arrived' },
		{ key: 'type', dot: 'type', title: 'Your type', hint: 'Of those matches, how many fit your type' },
		{ key: 'received', dot: 'received', title: 'Likes received', hint: 'Incoming likes' }
	];

	let counts = $state<Counts>({ sent: 0, matches: 0, type: 0, received: 0 });
	let notes = $state('');
	let hash = $state('');
	let saving = $state(false);
	let saved = $state(false);
	let problem = $state('');

	// Whenever the server hands us a different day's entry — the initial
	// load, or stepping the day — the local editable state resyncs to it.
	$effect(() => {
		const entry = data.entry;
		counts = { sent: entry.sent, matches: entry.matches, type: entry.type, received: entry.received };
		notes = entry.notes;
		hash = entry.hash;
		saving = false;
		saved = false;
		problem = '';
	});

	const isZero = $derived(counts.sent === 0 && counts.matches === 0 && counts.type === 0 && counts.received === 0);
	const isToday = $derived(data.day === data.today);
	const prevDay = $derived(shiftDayLabel(data.day, -1));
	const nextDay = $derived(shiftDayLabel(data.day, 1));

	function shiftDayLabel(day: string, offset: number): string {
		const [y, m, d] = day.split('-').map(Number);
		const date = new Date(y, m - 1, d + offset);
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	}

	/** "29 September 2026", without the weekday `relativeDay`/"Today" already says. */
	function longDate(day: string): string {
		const [y, m, d] = day.split('-').map(Number);
		return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
	}

	function bump(key: keyof Counts, by: number) {
		counts = { ...counts, [key]: Math.max(0, counts[key] + by) };
		saved = false;
	}

	async function save() {
		if (saving) return;
		saving = true;
		problem = '';
		const result = await api<{ hash: string }>('/api/dating/day', { day: data.day, ...counts, notes, expectedHash: hash });
		saving = false;
		if (!result.ok) {
			problem = result.message;
			if (result.kind === 'conflict') await goto(`/date?day=${data.day}`, { invalidateAll: true });
			return;
		}
		hash = result.value.hash;
		saved = true;
	}

	let likeName = $state('');
	let chance = $state(50);
	let liking = $state(false);
	let liked = $state('');
	let likeProblem = $state('');

	async function logLike() {
		if (liking || !likeName.trim()) return;
		liking = true;
		likeProblem = '';
		liked = '';
		const name = likeName.trim();
		const result = await api('/api/dating/people', { name, stage: 'liked', liked: data.day, chance });
		liking = false;
		if (!result.ok) {
			likeProblem = result.message;
			return;
		}
		liked = name;
		likeName = '';
		chance = 50;
	}
</script>

<svelte:head><title>Log · Date · prosoche</title></svelte:head>

<div class="stepper">
	<a
		class="btn step"
		href="/date?day={prevDay}"
		aria-label="Previous day"
		data-testid="dating-prev-day"
	><Icon name="chevron-left" /></a>

	<div class="day">
		<b>{data.day === data.today ? 'Today' : relativeDay(data.day, data.today).replace(/^./, (c) => c.toUpperCase())}</b>
		<span class="muted">{longDate(data.day)}</span>
	</div>

	{#if isToday}
		<span class="btn step ghost" aria-hidden="true"></span>
	{:else}
		<a class="btn step" href="/date?day={nextDay}" aria-label="Next day" data-testid="dating-next-day">
			<Icon name="chevron-right" />
		</a>
	{/if}
</div>

<div class="sheet rows counters" data-testid="dating-counters">
	{#each COUNTERS as c (c.key)}
		<div class="counter">
			<div class="about">
				<i class="dot {c.dot}"></i>
				<div>
					<div class="title">{c.title}</div>
					<div class="hint">{c.hint}</div>
				</div>
			</div>
			<div class="stepper-buttons">
				<button
					class="round"
					onclick={() => bump(c.key, -1)}
					disabled={counts[c.key] === 0}
					aria-label="Decrease {c.title}"
					data-testid="dating-{c.key}-minus"
				><Icon name="minus" size={18} /></button>
				<span class="num value {c.dot}" data-testid="dating-{c.key}-value">{counts[c.key]}</span>
				<button
					class="round"
					onclick={() => bump(c.key, 1)}
					aria-label="Increase {c.title}"
					data-testid="dating-{c.key}-plus"
				><Icon name="plus" size={18} /></button>
			</div>
		</div>
	{/each}

	<div class="notes-row">
		<label for="dating-notes">Notes</label>
		<span class="muted small">Optional</span>
	</div>
	<textarea
		id="dating-notes"
		class="field"
		rows="2"
		placeholder="Anything worth remembering about today"
		bind:value={notes}
		oninput={() => (saved = false)}
		data-testid="dating-notes"
	></textarea>
</div>

<button class="btn primary save" onclick={save} disabled={saving} data-testid="dating-save">
	{#if saving}Saving…{:else if saved}Saved{:else if isZero}Save as a zero day{:else}Save{/if}
</button>

{#if problem}<p class="problem">{problem}</p>{/if}

<p class="label">Sent a like</p>
<form class="sheet like-form" onsubmit={(e) => { e.preventDefault(); void logLike(); }} data-testid="dating-like-form">
	<input
		class="field"
		placeholder="Her name"
		bind:value={likeName}
		oninput={() => (liked = '')}
		aria-label="Name"
		required
		data-testid="dating-like-name"
	/>
	<label class="chance">
		<span>Chance she replies</span>
		<b class="num" data-testid="dating-like-chance-value">{chance}%</b>
		<input type="range" min="0" max="100" step="5" bind:value={chance} aria-label="Chance she replies" data-testid="dating-like-chance" />
	</label>
	<button class="btn" type="submit" disabled={liking} data-testid="dating-like-submit">
		{liking ? 'Adding…' : 'Add to People'}
	</button>
</form>
{#if likeProblem}<p class="problem">{likeProblem}</p>{/if}
{#if liked}
	<p class="hint" data-testid="dating-like-added">
		Added <a href="/date/people/{encodeURIComponent(liked)}">{liked}</a> to People.
	</p>
{/if}

<style>
	.stepper {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s3);
		margin-bottom: var(--s4);
	}
	.btn.step {
		width: 44px;
		height: 44px;
		padding: 0;
		justify-content: center;
		border-radius: var(--r-pill);
	}
	.btn.step.ghost {
		visibility: hidden;
	}
	.day {
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.day b {
		font-family: var(--serif);
		font-size: var(--t24);
		font-weight: 600;
	}
	.day .muted {
		font-size: var(--t13);
	}

	.counter {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s3);
	}
	.about {
		display: flex;
		align-items: flex-start;
		gap: var(--s3);
		min-width: 0;
	}
	.dot { margin-top: 6px; }
	.dot.sent { --dot: #b3372b; }
	.dot.matches { --dot: var(--accent); }
	.dot.type { --dot: var(--sand-edge); }
	.dot.received { --dot: #6a5aab; }
	.about .title { font-weight: 600; }
	.about .hint { color: var(--muted); font-size: var(--t13); margin-top: 1px; }

	.stepper-buttons { display: flex; align-items: center; gap: var(--s3); flex: none; }
	.round {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 1px solid var(--line);
		background: var(--soft);
		color: var(--text);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.round:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
	.round:disabled { opacity: 0.4; cursor: default; }
	.value {
		min-width: 2.4em;
		text-align: center;
		font-size: var(--t20);
		font-weight: 600;
	}
	.value.sent { color: #b3372b; }
	.value.matches { color: var(--accent); }
	.value.type { color: var(--sand-edge); }
	.value.received { color: #6a5aab; }

	.notes-row { display: flex; align-items: baseline; justify-content: space-between; padding-top: var(--s3); }
	.notes-row label { font-weight: 600; }
	textarea { margin-top: var(--s2); }

	.like-form { display: flex; flex-direction: column; gap: var(--s3); }
	.chance { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: var(--s2); font-weight: 600; }
	.chance input { grid-column: 1 / -1; width: 100%; accent-color: var(--accent); }
	.chance b { color: var(--accent); font-size: var(--t20); }
	.like-form .btn { justify-content: center; min-height: 44px; }

	.save {
		display: block;
		width: 100%;
		margin-top: var(--s4);
		padding: 14px;
		justify-content: center;
		font-size: var(--t16);
		min-height: 48px;
	}
</style>
