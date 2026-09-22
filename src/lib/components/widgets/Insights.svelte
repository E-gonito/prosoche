<script lang="ts">
	/**
	 * Ask a question about this workspace, without leaving it.
	 *
	 * Read-only, always. There is no accept button here and no proposal,
	 * because a chat answer never writes: anything that wants to change a note
	 * goes through `Proposal.svelte` on its own page. The settings row is
	 * shown rather than hidden, so the model, effort and permission for this
	 * particular question are visible at the moment it is asked.
	 */
	import RunSettings from '$lib/components/RunSettings.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { askQuestion } from '$lib/client/ai';
	import { scopeLabel, type Answer, type Refusal, type RunSettings as Run, type Scope } from '$lib/shared/ai';
	import type { LoadedWidget } from '$lib/shared/widgets';

	interface InsightsData {
		scope: Scope;
		label: string;
		notes: number;
		settings: Run;
		enabled: boolean;
		suggestions: string[];
	}

	let { widget }: { widget: LoadedWidget; refresh?: () => void } = $props();
	const data = $derived(widget.data as InsightsData);

	let question = $state('');
	let run = $state<Run | null>(null);
	let answer = $state<Answer | null>(null);
	let refusals = $state<Refusal[]>([]);
	let problem = $state('');
	let busy = $state(false);

	// The settings row edits a copy, so changing it here changes this run and
	// not the workspace's saved default.
	$effect(() => {
		if (!run && data?.settings) run = { ...data.settings };
	});

	const href = (path: string) => `/notes/${path.split('/').map(encodeURIComponent).join('/')}`;

	async function send(text: string) {
		if (!text.trim() || busy || !run) return;
		busy = true;
		answer = null;
		refusals = [];
		problem = '';
		const result = await askQuestion(text, data.scope, 'insights', run);
		busy = false;
		if (result.ok) {
			answer = result.value;
			if (result.value.problem) problem = result.value.problem;
			refusals = result.value.refusals ?? [];
		} else {
			problem = result.message;
			refusals = result.kind === 'refused' ? result.refusals : [];
		}
	}
</script>

{#if !data}
	<EmptyState icon="alert-triangle" title="Insights could not load." />
{:else if !data.enabled}
	<EmptyState testid="insights-off" icon="sparkles" title="AI is switched off.">
		{#snippet action()}
			<a class="btn ghost" href="/settings/ai">Turn it back on in Settings → AI</a>
		{/snippet}
	</EmptyState>
{:else}
	<div class="insights" data-testid="insights-widget">
		{#if run}<RunSettings bind:settings={run} lockPermission compact />{/if}

		<form
			onsubmit={(e) => {
				e.preventDefault();
				void send(question);
			}}
		>
			<input
				bind:value={question}
				placeholder="Ask about {data.label}…"
				aria-label="Ask about {data.label}"
				data-testid="insights-question"
			/>
			<button class="btn primary" disabled={busy} data-testid="insights-ask">{busy ? 'Thinking…' : 'Ask'}</button>
		</form>

		<p class="scope muted">{scopeLabel(data.scope)} · {data.notes} note{data.notes === 1 ? '' : 's'}</p>

		{#if !answer && !problem}
			<ul class="suggestions">
				{#each data.suggestions as s (s)}
					<li>
						<button
							class="btn ghost"
							onclick={() => {
								question = s;
								void send(s);
							}}>{s}</button
						>
					</li>
				{/each}
			</ul>
		{/if}

		{#if problem}
			<p class="problem" data-testid="insights-problem">{problem}</p>
			{#each refusals as refusal, i (i)}
				<p class="refusal"><span class="tag bad">{refusal.guardrail}</span> {refusal.title}: {refusal.message}</p>
			{/each}
		{/if}

		{#if answer && !problem}
			<div class="answer" data-testid="insights-answer">{answer.text}</div>
			{#if answer.citations.length}
				<p class="cites">
					Sources:
					{#each answer.citations as c (c.path + (c.heading ?? ''))}
						<a href={href(c.path)}>{c.title}</a>
					{/each}
				</p>
			{/if}
			<p class="stamp muted">
				{answer.stamp.model} · {answer.stamp.effort} · {answer.stamp.permission} ·
				${answer.stamp.costUsd.toFixed(4)} · {(answer.stamp.durationMs / 1000).toFixed(1)}s
			</p>
		{/if}
	</div>
{/if}

<style>
	.insights { display: flex; flex-direction: column; gap: var(--s2); }
	form { display: flex; gap: var(--s2); }
	input {
		flex: 1;
		min-width: 0;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: 7px 10px;
		font: inherit;
		background: var(--field);
	}
	.scope { font-size: var(--t12); margin: 0; }
	.suggestions { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
	.suggestions .btn { font-size: var(--t12); border-color: var(--line); }
	.answer { white-space: pre-wrap; font-size: var(--t14); }
	.cites { margin: 0; font-size: var(--t12); display: flex; gap: var(--s2); flex-wrap: wrap; }
	/* A run's numbers, so body text with the figures lined up. */
	.stamp { margin: 0; font-size: var(--t11); font-variant-numeric: tabular-nums; }
	/* `.problem` is shared, in app.css; this one sits in a `gap`-spaced flex
	   column that already spaces it, and reads beside `.muted` text a size up
	   from the rest, so both `margin` and `font-size` are overridden here. */
	.problem { margin: 0; font-size: var(--t13); }
	.refusal { margin: 0; font-size: var(--t12); color: var(--muted); }
	.muted { color: var(--muted); font-size: var(--t13); }
</style>
