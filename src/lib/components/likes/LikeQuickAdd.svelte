<script lang="ts">
	/**
	 * Log a like sent, in as few taps as a phone allows: a nickname, the day
	 * (today unless changed), a forecast in 5% steps with a box for any other
	 * number, the tags, and an age. Every tag starts unknown and stays so
	 * unless tapped. The forecast is what `OUTCOME` names, and the label says
	 * so. A forecast of 0 or 100 is saved as 2 or 98, and the form says that
	 * before it is sent.
	 *
	 * Emits nothing: it posts to `/api/dating/likes` and reloads the page's
	 * data, so whichever page holds it shows the new like.
	 */
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/client/api';
	import { clampForecast, FORECAST_LABEL, type LikedOn } from '$lib/shared/likes';
	import LikeTag from './LikeTag.svelte';

	let { today, typeHtml }: { today: string; typeHtml: string } = $props();

	const YES_NO = [
		{ value: true, label: 'Yes' },
		{ value: false, label: 'No' }
	];
	const LIKED_ON: Array<{ value: LikedOn; label: string }> = [
		{ value: 'photo', label: 'Photo' },
		{ value: 'prompt', label: 'Prompt' }
	];
	/** Where the forecast starts. Most of these likes are long shots, so low rather than an even 50. */
	const START = 10;

	let label = $state('');
	// svelte-ignore state_referenced_locally
	let sentDate = $state(today);
	let forecast = $state<number>(START);
	let outOfLeague = $state<boolean | null>(null);
	let fitsType = $state<boolean | null>(null);
	let likedOn = $state<LikedOn | null>(null);
	let commented = $state<boolean | null>(null);
	let age = $state<number | null>(null);
	let saving = $state(false);
	let problem = $state('');
	let added = $state('');

	const saves = $derived(Number.isFinite(forecast) ? clampForecast(forecast) : null);

	async function submit(event: Event) {
		event.preventDefault();
		if (saving || !label.trim() || saves === null) return;
		saving = true;
		problem = '';
		added = '';
		const result = await api<{ like: { label: string } }>('/api/dating/likes', {
			label: label.trim(),
			sentDate,
			forecast,
			outOfLeague,
			fitsType,
			likedOn,
			commented,
			age: age === null || !Number.isFinite(age) ? null : Math.round(age)
		});
		saving = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		added = result.value.like.label;
		label = '';
		forecast = START;
		outOfLeague = fitsType = commented = null;
		likedOn = null;
		age = null;
		await invalidateAll();
	}
</script>

<form class="sheet quick-add" onsubmit={submit} data-testid="like-quick-add">
	<div class="row">
		<input class="field" placeholder="Nickname, not full name" bind:value={label} aria-label="Nickname" autocomplete="off" required data-testid="like-label" />
		<input class="field date" type="date" bind:value={sentDate} max={today} aria-label="Day sent" required data-testid="like-date" />
	</div>

	<div class="forecast">
		<label for="like-forecast-range">{FORECAST_LABEL}</label>
		<input
			class="field num"
			type="number"
			min="0"
			max="100"
			step="1"
			bind:value={forecast}
			aria-label="{FORECAST_LABEL}, any whole percent"
			data-testid="like-forecast"
		/>
		<input id="like-forecast-range" type="range" min="0" max="100" step="5" bind:value={forecast} data-testid="like-forecast-range" />
		{#if saves !== null && saves !== forecast}<p class="hint" data-testid="like-forecast-clamp">Saves as {saves}%: nothing is ever certain.</p>{/if}
	</div>

	<LikeTag label="Out of my league" bind:value={outOfLeague} options={YES_NO} testid="like-out-of-league" />
	<LikeTag label="Fits my type" bind:value={fitsType} options={YES_NO} testid="like-fits-type" />
	{#if typeHtml}
		<details class="type" data-testid="like-type-note">
			<summary>My type</summary>
			<div class="prose">{@html typeHtml}</div>
		</details>
	{/if}
	<LikeTag label="Liked on" bind:value={likedOn} options={LIKED_ON} testid="like-liked-on" />
	<LikeTag label="Commented" bind:value={commented} options={YES_NO} testid="like-commented" />
	<label class="age">
		<span>Age</span>
		<input class="field num" type="number" min="18" max="99" inputmode="numeric" placeholder="?" bind:value={age} data-testid="like-age" />
	</label>

	<button class="btn primary" type="submit" disabled={saving || !label.trim()} data-testid="like-submit">{saving ? 'Logging…' : 'Log like'}</button>
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	{#if added}<p class="hint" data-testid="like-added">Logged {added}, pending.</p>{/if}
</form>

<style>
	.quick-add { display: flex; flex-direction: column; gap: var(--s3); }
	.row { display: flex; gap: var(--s2); }
	.row .field:first-child { flex: 1; min-width: 0; }
	.date { width: 10.5em; }
	.forecast { display: grid; grid-template-columns: 1fr 5em; align-items: center; gap: var(--s2); font-weight: 600; font-size: var(--t14); }
	.forecast input[type='range'] { grid-column: 1 / -1; width: 100%; min-height: 36px; }
	.forecast .hint { grid-column: 1 / -1; margin: 0; font-weight: 400; }
	.age { display: flex; align-items: center; justify-content: space-between; font-weight: 600; font-size: var(--t14); }
	.age input { width: 5em; }
	.type summary { cursor: pointer; color: var(--accent); font-size: var(--t13); }
	.type .prose { font-size: var(--t13); margin-top: var(--s2); }
	.btn.primary { min-height: 44px; justify-content: center; }
	.field { min-height: 44px; }
</style>
