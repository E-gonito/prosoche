<script lang="ts">
	/**
	 * AI settings: model, effort, budget and timeout for every feature, the
	 * limits they all sit under, and the record of what has happened.
	 *
	 * The page is a form over `_hub/ai.md`, which is the user's own markdown
	 * file. That is why the path is printed at the top: anything here can be
	 * edited in Obsidian instead, and neither copy is the real one.
	 *
	 * There is no permission column. Every run is read-only, and a mode that
	 * could be changed here would be a guardrail someone could switch off.
	 */
	import {
		EFFORTS,
		FEATURE_LABELS,
		GUARDRAILS,
		type AiSettings,
		type FeatureId
	} from '$lib/shared/ai';
	import { api } from '$lib/client/api';
	import { onMount } from 'svelte';

	let { data } = $props();

	// Edited in place and saved explicitly, so it is seeded once rather than
	// tracked: a reload mid-edit must not discard what is on screen.
	// svelte-ignore state_referenced_locally
	let settings = $state<AiSettings>(structuredClone(data.settings));
	let saved = $state('');
	let problem = $state('');
	let busy = $state(false);

	// Notifications. The server says whether it can send; the browser says
	// whether this page may ask for permission and whether it already has.
	type Device = { endpoint: string; label: string; addedAt: string };
	// svelte-ignore state_referenced_locally
	let devices = $state<Device[]>(data.push.devices);
	let secure = $state(true);
	let permission = $state<NotificationPermission | 'unsupported'>('default');
	let here = $state<string | null>(null);
	let pushNote = $state('');
	let pushBusy = $state(false);

	onMount(async () => {
		secure = window.isSecureContext;
		permission = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window ? Notification.permission : 'unsupported';
		if (secure && permission !== 'unsupported') here = (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.endpoint ?? null;
	});

	/** "Chrome on Android": enough to tell a phone from a laptop in a list. */
	function deviceLabel(): string {
		const ua = navigator.userAgent;
		const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
		const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'this device';
		return `${browser} on ${os}`;
	}

	/** The server's key arrives as URL-safe base64; `subscribe` wants the bytes. */
	function keyBytes(key: string): Uint8Array<ArrayBuffer> {
		const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
		return Uint8Array.from(raw, (c) => c.charCodeAt(0));
	}

	async function refreshDevices() {
		const result = await api<{ devices: Device[] }>('/api/push');
		if (result.ok) devices = result.value.devices;
	}

	async function turnOn() {
		if (!data.push.status.configured) return;
		pushBusy = true;
		pushNote = '';
		try {
			permission = await Notification.requestPermission();
			if (permission !== 'granted') return;
			const registration = await navigator.serviceWorker.ready;
			const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(data.push.status.publicKey) });
			const result = await api('/api/push', { action: 'subscribe', subscription: subscription.toJSON(), label: deviceLabel() });
			if (result.ok) here = subscription.endpoint;
			else pushNote = result.message;
			await refreshDevices();
		} catch (e) {
			pushNote = `Could not turn notifications on: ${e instanceof Error ? e.message : e}`;
		} finally {
			pushBusy = false;
		}
	}

	async function remove(endpoint: string) {
		pushBusy = true;
		const result = await api('/api/push', { action: 'unsubscribe', endpoint });
		if (result.ok && endpoint === here) {
			await (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.unsubscribe();
			here = null;
		}
		pushNote = result.ok ? '' : result.message;
		await refreshDevices();
		pushBusy = false;
	}

	async function sendTest() {
		pushBusy = true;
		const result = await api<{ sent: number; failed: number; removed: number }>('/api/push', { action: 'test' });
		pushNote = !result.ok
			? result.message
			: result.value.sent
				? `Sent to ${result.value.sent} device${result.value.sent === 1 ? '' : 's'}.`
				: result.value.failed
					? 'It could not be delivered. The server log says why.'
					: 'No device is subscribed yet.';
		await refreshDevices();
		pushBusy = false;
	}

	// Focus. Each field saves when it changes, as a patch of just that field;
	// the server answers the settings as it wrote them, so a refused value
	// snaps back to what is stored.
	const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
	// svelte-ignore state_referenced_locally
	let focus = $state({ warmupMin: data.focus.warmupMin, windDownMin: data.focus.rules.windDownMin, followUpMin: data.focus.rules.followUpMin, planBy: hhmm(data.focus.planByMin) });
	let focusNote = $state('');
	let focusProblem = $state('');

	async function saveFocus(patch: Partial<typeof focus>) {
		focusNote = '';
		focusProblem = '';
		const result = await api<{ warmupMin: number; rules: { windDownMin: number; followUpMin: number }; planByMin: number }>('/api/focus/settings', patch);
		if (result.ok) {
			focus = { warmupMin: result.value.warmupMin, windDownMin: result.value.rules.windDownMin, followUpMin: result.value.rules.followUpMin, planBy: hhmm(result.value.planByMin) };
			focusNote = 'Saved.';
		} else {
			focusProblem = result.message;
		}
	}

	const features = $derived(Object.keys(settings.features) as FeatureId[]);

	async function save() {
		busy = true;
		saved = '';
		problem = '';
		const result = await api<{ settings: AiSettings }>('/api/ai/settings', settings);
		busy = false;
		if (result.ok) {
			settings = result.value.settings;
			saved = `Saved to ${data.settingsPath}.`;
		} else {
			problem = result.message;
		}
	}

	async function revert(id: string) {
		busy = true;
		const result = await api<{ undone: { restored: string[]; skipped: string[] } }>('/api/ai/proposal', { action: 'undo', undoId: id });
		busy = false;
		saved = result.ok
			? `Put back ${result.value.undone.restored.length} file${result.value.undone.restored.length === 1 ? '' : 's'}.`
			: '';
		problem = result.ok ? '' : result.message;
	}
</script>

<svelte:head><title>Settings · prosoche</title></svelte:head>

<div class="page">

<div class="title">
	<h1>Settings</h1>
	<p><span class="path">{data.settingsPath}</span></p>
</div>

<section class="card" data-testid="notifications">
	<h3>Notifications</h3>
	{#if !data.push.status.configured}
		<p class="bad" data-testid="push-reason">{data.push.status.reason}</p>
	{:else if !secure}
		<p class="bad">
			This page is on a plain http address, and browsers only allow notifications on a secure one. Open prosoche at its https address
			(see <code>docs/deploy.md</code>) and turn them on from there.
		</p>
	{:else if permission === 'unsupported'}
		<p class="bad">This browser cannot receive push notifications.</p>
	{:else if permission === 'denied'}
		<p class="bad">
			Notifications are blocked for this site. Allow them in the browser's site settings (the padlock or tune icon by the address),
			then reload this page.
		</p>
	{:else if here && devices.some((d) => d.endpoint === here)}
		<p>Notifications are on for this device.</p>
	{:else}
		<p>Get a nudge outside the app when a block is about to start.</p>
		<button class="btn primary" disabled={pushBusy} onclick={turnOn} data-testid="push-on">Turn on for this device</button>
	{/if}

	{#if devices.length}
		<ul class="snaps" data-testid="push-devices">
			{#each devices as d (d.endpoint)}
				<li>
					<span class="files">{d.label}{d.endpoint === here ? ' (this device)' : ''}</span>
					<span class="when">{d.addedAt.slice(0, 10)}</span>
					<button class="btn" disabled={pushBusy} onclick={() => remove(d.endpoint)}>Remove</button>
				</li>
			{/each}
		</ul>
		{#if data.push.status.configured}
			<p><button class="btn" disabled={pushBusy} onclick={sendTest} data-testid="push-test">Send a test</button></p>
		{/if}
	{:else if data.push.status.configured}
		<p class="muted">No device is subscribed.</p>
	{/if}
	{#if pushNote}<p class="hint" data-testid="push-note">{pushNote}</p>{/if}
</section>

<section class="card" data-testid="focus-settings">
	<h3>Focus</h3>
	<div class="kv">
		<b>Warm-up</b>
		<span><input type="number" min="1" max="60" bind:value={focus.warmupMin} onchange={() => saveFocus({ warmupMin: focus.warmupMin })} data-testid="focus-warmup" aria-label="Warm-up minutes" /> minutes of "just a few minutes" after Start</span>
		<b>Wind-down nudge</b>
		<span><input type="number" min="1" max="60" bind:value={focus.windDownMin} onchange={() => saveFocus({ windDownMin: focus.windDownMin })} data-testid="focus-wind-down" aria-label="Minutes before a block for the wind-down nudge" /> minutes before a block</span>
		<b>Follow-up nudge</b>
		<span><input type="number" min="1" max="60" bind:value={focus.followUpMin} onchange={() => saveFocus({ followUpMin: focus.followUpMin })} data-testid="focus-follow-up" aria-label="Minutes after a block starts for the follow-up nudge" /> minutes after it starts</span>
		<b>No plan yet</b>
		<span><input type="time" bind:value={focus.planBy} onchange={() => saveFocus({ planBy: focus.planBy })} data-testid="focus-plan-by" aria-label="Time to mention a day with no plan" /> if today has no timed block by then</span>
	</div>
	{#if focusNote}<p class="ok" data-testid="focus-saved">{focusNote}</p>{/if}
	{#if focusProblem}<p class="bad" data-testid="focus-problem">{focusProblem}</p>{/if}
	<p class="hint">Saved to <code>_hub/focus.md</code> as you change them.</p>
</section>

<section class="card">
	<h3>Kill switch</h3>
	<label class="switch">
		<input type="checkbox" bind:checked={settings.enabled} data-testid="ai-enabled" />
		<span>
			AI is <b>{settings.enabled ? 'on' : 'off'}</b>.
			{#if settings.enabled}
				Turning it off stops every surface and every scheduled job at once.
			{:else}
				Every AI surface and scheduled job is disabled.
			{/if}
		</span>
	</label>
</section>

<section class="card">
	<h3>Per feature</h3>
	<table data-testid="feature-table">
		<thead>
			<tr><th>Feature</th><th>Model</th><th>Effort</th><th>Budget</th><th>Timeout</th></tr>
		</thead>
		<tbody>
			{#each features as feature (feature)}
				<tr data-feature={feature}>
					<th scope="row">{FEATURE_LABELS[feature]}</th>
					<td>
						<select bind:value={settings.features[feature].model} aria-label="{FEATURE_LABELS[feature]} model" data-testid="model-{feature}">
							{#each data.models as m (m.id)}<option value={m.id} title={m.hint}>{m.label}</option>{/each}
						</select>
					</td>
					<td>
						<select bind:value={settings.features[feature].effort} aria-label="{FEATURE_LABELS[feature]} effort" data-testid="effort-{feature}">
							{#each EFFORTS as e (e)}<option value={e}>{e}</option>{/each}
						</select>
					</td>
					<td><input type="number" min="0.01" max="2" step="0.05" bind:value={settings.features[feature].budgetUsd} aria-label="{FEATURE_LABELS[feature]} budget" /></td>
					<td><input type="number" min="5" max="900" step="5" bind:value={settings.features[feature].timeoutSeconds} aria-label="{FEATURE_LABELS[feature]} timeout" /></td>
				</tr>
			{/each}
		</tbody>
	</table>
	<p class="hint">Every run is read-only. There is no mode that writes without you.</p>
</section>

<section class="card">
	<h3>Limits</h3>
	<div class="kv">
		<b>Daily budget</b>
		<span><input type="number" min="0" max="100" step="0.5" bind:value={settings.budget.dailyUsd} data-testid="daily-budget" aria-label="Daily budget" /> US dollars</span>
		<b>Files per proposal</b>
		<span><input type="number" min="1" max="20" bind:value={settings.blast.maxFiles} data-testid="max-files" aria-label="Files per proposal" /></span>
		<b>Lines a file may lose</b>
		<span><input type="number" min="0" max="1" step="0.05" bind:value={settings.blast.maxLineLoss} aria-label="Line loss limit" /> as a fraction</span>
	</div>
</section>

<div class="actions">
	<button class="btn primary" disabled={busy} onclick={save} data-testid="save-ai-settings">Save</button>
	{#if saved}<span class="ok" data-testid="settings-saved">{saved}</span>{/if}
	{#if problem}<span class="bad">{problem}</span>{/if}
</div>

<section class="card">
	<h3>Today <span class="right muted">{data.day}</span></h3>
	<p class="spend" data-testid="ai-spend">
		${data.spend.usd.toFixed(4)} spent over {data.spend.runs} run{data.spend.runs === 1 ? '' : 's'}, against a
		${settings.budget.dailyUsd.toFixed(2)} cap. The CLI is <code>{data.executable}</code>.
	</p>
	{#if data.runs.length}
		<pre class="log" data-testid="ai-log">{data.runs.join('\n')}</pre>
	{:else}
		<p class="muted">Nothing has run today.</p>
	{/if}
</section>

<section class="card">
	<h3>Undo</h3>
	{#if data.snapshots.length}
		<ul class="snaps" data-testid="undo-list">
			{#each data.snapshots as snap (snap.id)}
				<li>
					<span class="when">{snap.at.slice(0, 16).replace('T', ' ')}</span>
					<span class="files">{snap.paths.join(', ')}</span>
					<button class="btn" disabled={busy} onclick={() => revert(snap.id)} data-testid="undo-{snap.id}">Put back</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">No snapshots. One is taken before anything is applied, and kept for seven days.</p>
	{/if}
</section>

<section class="card">
	<h3>The nine guardrails</h3>
	<ol class="rails">
		{#each Object.entries(GUARDRAILS) as [id, title] (id)}
			<li><span class="tag">{id}</span> {title}</li>
		{/each}
	</ol>
	<p class="hint">These are code paths, not instructions in a prompt.</p>
</section>
</div>

<style>
	/* A path, so monospaced. */
	.path { font: var(--t12) var(--mono); }
	section { margin-bottom: 14px; }
	.switch { display: flex; align-items: flex-start; gap: 10px; font-size: var(--t14); }
	table { border-collapse: collapse; width: 100%; font-size: var(--t13); }
	th, td { text-align: left; padding: 5px var(--s2); border-bottom: 1px solid var(--line); }
	thead th { font-size: var(--t11); text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
	tbody th { font-weight: 500; }
	select, input {
		font: inherit;
		font-size: var(--t13);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		padding: 3px 6px;
		background: var(--field);
		color: inherit;
	}
	input[type='number'] { width: 76px; }
	.actions { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
	.ok { color: var(--ok); font-size: var(--t13); }
	.bad { color: var(--bad); font-size: var(--t13); }
	.spend { margin: 0 0 var(--s2); font-size: var(--t13); }
	.log { max-height: 300px; overflow: auto; font: var(--t11)/1.6 var(--mono); white-space: pre; margin: 0; }
	.snaps { list-style: none; margin: 0; padding: 0; font-size: var(--t13); }
	.snaps li { display: flex; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--line); }
	/* A date, so body text with the figures lined up rather than monospace. */
	.when { font-size: var(--t11); font-variant-numeric: tabular-nums; color: var(--muted); }
	.files { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.rails { margin: 0; padding-left: 0; list-style: none; display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--s1) var(--s4); font-size: var(--t13); }
	/* A guardrail's name, drawn as the shared `.tag` but stated firmly. */
	.rails .tag { font-weight: 700; }
	code { font: var(--t11) var(--mono); background: var(--soft); border-radius: 4px; padding: 1px 5px; }
</style>
