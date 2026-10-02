<script lang="ts">
	/**
	 * One like, opened for editing: its day, forecast, tags, age and status,
	 * saved together in one request with the hash it was opened with. A like
	 * changed elsewhere meanwhile is a conflict and nothing is written. The
	 * nickname is the note's file name and is not edited here.
	 */
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/client/api';
	import { clampForecast, FORECAST_LABEL, LIKE_STATUSES, type Like, type LikedOn, type LikeStatus } from '$lib/shared/likes';
	import LikeTag from './LikeTag.svelte';

	let { like, today, onclose }: { like: Like; today: string; onclose: () => void } = $props();

	const YES_NO = [
		{ value: true, label: 'Yes' },
		{ value: false, label: 'No' }
	];
	const LIKED_ON: Array<{ value: LikedOn; label: string }> = [
		{ value: 'photo', label: 'Photo' },
		{ value: 'prompt', label: 'Prompt' }
	];

	// Seeded once from the like, as every form here is: a reload must not undo what is typed.
	/* svelte-ignore state_referenced_locally */
	let sentDate = $state(like.sentDate);
	/* svelte-ignore state_referenced_locally */
	let forecast = $state<number>(like.forecast);
	/* svelte-ignore state_referenced_locally */
	let outOfLeague = $state(like.outOfLeague);
	/* svelte-ignore state_referenced_locally */
	let fitsType = $state(like.fitsType);
	/* svelte-ignore state_referenced_locally */
	let likedOn = $state(like.likedOn);
	/* svelte-ignore state_referenced_locally */
	let commented = $state(like.commented);
	/* svelte-ignore state_referenced_locally */
	let age = $state<number | null>(like.age);
	/* svelte-ignore state_referenced_locally */
	let status = $state<LikeStatus>(like.status);
	let saving = $state(false);
	let problem = $state('');

	async function save() {
		if (saving || !Number.isFinite(forecast)) return;
		saving = true;
		problem = '';
		const fields: Record<string, unknown> = {};
		if (sentDate !== like.sentDate) fields.sentDate = sentDate;
		if (clampForecast(forecast) !== like.forecast) fields.forecast = forecast;
		if (outOfLeague !== like.outOfLeague) fields.outOfLeague = outOfLeague;
		if (fitsType !== like.fitsType) fields.fitsType = fitsType;
		if (likedOn !== like.likedOn) fields.likedOn = likedOn;
		if (commented !== like.commented) fields.commented = commented;
		const typedAge = age === null || !Number.isFinite(age) ? null : Math.round(age);
		if (typedAge !== like.age) fields.age = typedAge;
		const result = await api('/api/dating/likes', { label: like.label, expectedHash: like.hash, fields, status: status !== like.status ? status : undefined }, { method: 'PUT' });
		saving = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		await invalidateAll();
		onclose();
	}
</script>

<div class="editor" data-testid="like-editor">
	<label class="line"><span>Sent</span><input class="field" type="date" max={today} bind:value={sentDate} data-testid="like-edit-date" /></label>
	<label class="line"><span>{FORECAST_LABEL}</span><input class="field num" type="number" min="0" max="100" bind:value={forecast} data-testid="like-edit-forecast" /></label>
	<LikeTag label="Out of my league" bind:value={outOfLeague} options={YES_NO} testid="like-edit-out-of-league" />
	<LikeTag label="Fits my type" bind:value={fitsType} options={YES_NO} testid="like-edit-fits-type" />
	<LikeTag label="Liked on" bind:value={likedOn} options={LIKED_ON} testid="like-edit-liked-on" />
	<LikeTag label="Commented" bind:value={commented} options={YES_NO} testid="like-edit-commented" />
	<label class="line"><span>Age</span><input class="field num" type="number" min="18" max="99" placeholder="?" bind:value={age} data-testid="like-edit-age" /></label>
	<label class="line">
		<span>Outcome</span>
		<select class="field" bind:value={status} data-testid="like-edit-status">
			{#each LIKE_STATUSES as s (s)}<option value={s}>{s}</option>{/each}
		</select>
	</label>
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	<div class="actions">
		<button class="btn primary" onclick={save} disabled={saving} data-testid="like-edit-save">{saving ? 'Saving…' : 'Save'}</button>
		<button class="btn ghost" onclick={onclose} disabled={saving}>Cancel</button>
		<a class="small" href="/date/people/{encodeURIComponent(like.label)}">Her note</a>
	</div>
</div>

<style>
	.editor { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s3) 0; }
	.line { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); font-weight: 600; font-size: var(--t14); }
	.line .field { width: 10.5em; min-height: 40px; }
	.line .num { width: 5em; }
	.actions { display: flex; align-items: center; gap: var(--s2); }
	.actions a { margin-left: auto; }
</style>
