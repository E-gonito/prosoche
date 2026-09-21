<script lang="ts">
	/**
	 * What a share looks like before it is a line in the Inbox.
	 *
	 * The shared text is offered for editing rather than filed on arrival, for
	 * two reasons: half of what a phone shares needs a word of context to be
	 * worth anything a week later, and a share target can fire by accident from
	 * a long press. Nothing is written until the button is pressed.
	 */
	import { captureText } from '$lib/client/api';

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	let text = $state(data.text);
	let saved = $state('');
	let problem = $state('');
	let busy = $state(false);
	let box: HTMLTextAreaElement | undefined = $state();

	$effect(() => {
		// The caret goes after the shared text, which is where the note goes.
		if (box && !saved) box.setSelectionRange(box.value.length, box.value.length);
		box?.focus();
	});

	async function save() {
		if (!text.trim() || busy) return;
		busy = true;
		problem = '';
		const result = await captureText(text);
		busy = false;
		if (result.ok) {
			saved = result.value.path;
			text = '';
		} else {
			problem = result.message;
		}
	}
</script>

<svelte:head><title>Share · prosoche</title></svelte:head>

<h1>Share to Inbox</h1>

{#if saved}
	<div class="card done">
		<p>Saved to <a href="/notes/{saved.split('/').map(encodeURIComponent).join('/')}">{saved}</a>.</p>
		<p class="row">
			<a class="btn" href="/">Today</a>
			<button class="btn" onclick={() => (saved = '')}>Share something else</button>
		</p>
	</div>
{:else}
	<div class="card">
		<label for="share-text">This goes into today's section of the Inbox.</label>
		<textarea
			id="share-text"
			bind:this={box}
			bind:value={text}
			rows="5"
			placeholder="Nothing came through. Type what you wanted to keep."
		></textarea>
		<div class="row">
			<button class="btn primary" onclick={save} disabled={busy || !text.trim()}>
				{busy ? 'Saving…' : 'Save to Inbox'}
			</button>
			<a class="btn" href="/">Cancel</a>
		</div>
		{#if problem}<p class="problem">{problem}</p>{/if}
	</div>
{/if}

<style>
	h1 { font-size: 22px; margin: 0 0 14px; }
	.card { max-width: 560px; }
	label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 8px; }
	textarea {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 10px 12px;
		font: inherit;
		resize: vertical;
	}
	.row { display: flex; gap: 8px; align-items: center; margin: 10px 0 0; }
	.done p { margin: 0 0 10px; }
	.problem { color: var(--bad); font-size: 13px; margin: 10px 0 0; }
</style>
