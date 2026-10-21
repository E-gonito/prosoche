<script lang="ts">
	/**
	 * Hear a word: a speaker button that reads it with the device's own voice
	 * for the language (hidden when the device has none) and a link to the
	 * native-speaker recordings on Forvo (always there). For a glossary that
	 * sets `pronounce:`.
	 */
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { speak, watchVoice } from '$lib/client/speak';
	import { forvoHref } from '$lib/shared/pronounce';

	let { term, code }: { term: string; code: string } = $props();

	let voice = $state<SpeechSynthesisVoice | undefined>();
	onMount(() => watchVoice(code, (v) => (voice = v)));
</script>

<span class="hear">
	{#if voice}
		<button type="button" class="speak" onclick={() => speak(term, voice!)} aria-label="Say “{term}”" title="Say it" data-testid="speak"><Icon name="volume" size={16} /></button>
	{/if}
	<a class="forvo" href={forvoHref(term, code)} target="_blank" rel="noopener" title="Native speakers on Forvo" data-testid="forvo">Hear it</a>
</span>

<style>
	.hear { display: inline-flex; align-items: center; gap: var(--s2); font-size: var(--t13); font-weight: 400; }
	.speak { display: inline-grid; place-items: center; width: 32px; height: 32px; border: 1px solid var(--line); border-radius: var(--r-pill); background: var(--panel); color: var(--muted); cursor: pointer; }
	.speak:hover { color: var(--accent); border-color: var(--accent); }
	.forvo { color: var(--muted); }
</style>
