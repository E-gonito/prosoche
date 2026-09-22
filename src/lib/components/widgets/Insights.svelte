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
				<p class="refusal"><span class="badge">{refusal.guardrail}</span> {refusal.title}: {refusal.message}</p>
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
	.insights { display: flex; flex-direction: column; gap: 8px; }
	form { display: flex; gap: 8px; }
	input {
		flex: 1;
		min-width: 0;
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 7px 10px;
		font: inherit;
	}
	.scope { font-size: 12px; margin: 0; }
	.suggestions { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
	.suggestions .btn { font-size: 12px; border-color: var(--line); }
	.answer { white-space: pre-wrap; font-size: 14px; }
	.cites { margin: 0; font-size: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
	.stamp { margin: 0; font: 11px var(--mono); }
	.problem { margin: 0; color: var(--bad); font-size: 13px; }
	.refusal { margin: 0; font-size: 12px; color: var(--muted); }
	.badge {
		font: 11px var(--mono);
		font-weight: 700;
		background: var(--bad);
		color: #fff;
		border-radius: 4px;
		padding: 1px 5px;
	}
	.muted { color: var(--muted); font-size: 13px; }
</style>
