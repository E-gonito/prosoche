<script lang="ts">
	/**
	 * Ask: a question, a scope, and answers that cite what they read.
	 *
	 * Read-only throughout. There is no accept button on this page because
	 * there is nothing to accept: an answer is prose, and anything that would
	 * change a note goes through a proposal on its own screen. The citations
	 * are links rather than footnotes, because the point of them is to be
	 * followed when an answer looks wrong.
	 */
	import PageHeader from '$lib/components/PageHeader.svelte';
	import RunSettings from '$lib/components/RunSettings.svelte';
	import { askQuestion } from '$lib/client/ai';
	import { scopeLabel, type Answer, type Refusal, type RunSettings as Run, type Scope } from '$lib/shared/ai';

	let { data } = $props();

	// The form is seeded from the load, then owned by the user. Following `data`
	// afterwards would overwrite a half-typed question on every navigation.
	// svelte-ignore state_referenced_locally
	let question = $state(data.question);
	// svelte-ignore state_referenced_locally
	let run = $state<Run>({ ...data.settings });
	// svelte-ignore state_referenced_locally
	let scopeKey = $state(data.note ? `note:${data.note}` : 'vault');
	let turns = $state<Answer[]>([]);
	let refusals = $state<Refusal[]>([]);
	let problem = $state('');
	let busy = $state(false);
	let box: HTMLInputElement | undefined = $state();

	const scopes = $derived([
		{ key: 'vault', label: 'Whole vault' },
		...(data.note ? [{ key: `note:${data.note}`, label: `This note: ${data.note}` }] : []),
		...data.workspaces.map((w) => ({ key: `workspace:${w.slug}`, label: `Workspace: ${w.name}` })),
		...data.folders.map((f) => ({ key: `folder:${f}`, label: `Folder: ${f}` }))
	]);

	function toScope(key: string): Scope {
		const [kind, rest] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
		if (key === 'vault') return { kind: 'vault' };
		if (kind === 'workspace') return { kind: 'workspace', slug: rest };
		if (kind === 'folder') return { kind: 'folder', path: rest };
		return { kind: 'note', path: rest };
	}

	const href = (path: string) => `/notes/${path.split('/').map(encodeURIComponent).join('/')}`;

	async function send() {
		const text = question.trim();
		if (!text || busy) return;
		busy = true;
		problem = '';
		refusals = [];
		const result = await askQuestion(text, toScope(scopeKey), 'ask', run);
		busy = false;
		if (result.ok) {
			turns = [result.value, ...turns];
			if (result.value.problem) problem = result.value.problem;
			refusals = result.value.refusals ?? [];
			if (!result.value.problem) question = '';
		} else {
			problem = result.message;
			refusals = result.kind === 'refused' ? result.refusals : [];
		}
		box?.focus();
	}
</script>

<svelte:head><title>Ask · prosoche</title></svelte:head>

<PageHeader title="Ask">
	{#snippet actions()}
		<a class="btn ghost" href="/settings/ai" data-testid="ai-settings-link">AI settings</a>
	{/snippet}
</PageHeader>

{#if !data.enabled}
	<div class="card empty" data-testid="ask-off">
		AI is switched off. Turn it back on in <a href="/settings/ai">Settings → AI</a>.
	</div>
{:else}
	<div class="card asker">
		<RunSettings bind:settings={run} lockPermission />

		<form
			onsubmit={(e) => {
				e.preventDefault();
				void send();
			}}
		>
			<select bind:value={scopeKey} aria-label="Scope" data-testid="ask-scope">
				{#each scopes as s (s.key)}
					<option value={s.key}>{s.label}</option>
				{/each}
			</select>
			<input
				bind:this={box}
				bind:value={question}
				placeholder="Ask your notes something…"
				aria-label="Your question"
				data-testid="ask-question"
			/>
			<button class="btn primary" disabled={busy} data-testid="ask-send">{busy ? 'Thinking…' : 'Ask'}</button>
		</form>

		<p class="hint">
			Answers are read-only. Nothing on this page can change a note, whatever the answer says.
		</p>

		{#if problem}
			<p class="problem" data-testid="ask-problem">{problem}</p>
			{#each refusals as refusal, i (i)}
				<p class="refusal" data-testid="ask-refusal">
					<span class="badge">{refusal.guardrail}</span>
					<b>{refusal.title}</b> — {refusal.message}
				</p>
			{/each}
		{/if}
	</div>

	{#each turns as turn, i (turn.stamp.startedAt + i)}
		<article class="card turn" data-testid="ask-answer">
			<p class="asked"><b>{turn.question}</b> <span class="muted">· {scopeLabel(turn.scope)}</span></p>
			<div class="answer">{turn.text}</div>
			{#if turn.citations.length}
				<p class="cites" data-testid="ask-citations">
					Sources:
					{#each turn.citations as c (c.path + (c.heading ?? ''))}
						<a href={href(c.path)} title={c.path}>{c.title}{c.heading ? ` ${c.heading}` : ''}</a>
					{/each}
				</p>
			{:else}
				<p class="cites muted">No notes matched, so this answer cites nothing.</p>
			{/if}
			<p class="stamp muted">
				{turn.stamp.model} · {turn.stamp.effort} · {turn.stamp.permission} · ${turn.stamp.costUsd.toFixed(4)} ·
				{(turn.stamp.durationMs / 1000).toFixed(1)}s
			</p>
		</article>
	{/each}

	{#if turns.length === 0 && data.history}
		<details class="card">
			<summary>Earlier conversations</summary>
			<p class="muted small">
				Kept as markdown in <code>{data.historyPath}</code>, so it syncs with everything else and no AI path can edit it.
			</p>
			<pre class="history">{data.history}</pre>
		</details>
	{/if}
{/if}

<style>
	.asker { display: flex; flex-direction: column; gap: 10px; }
	form { display: flex; gap: 8px; flex-wrap: wrap; }
	select,
	input {
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 8px 10px;
		font: inherit;
		background: var(--panel);
		color: inherit;
	}
	input { flex: 1; min-width: 220px; }
	.turn { margin-top: 12px; }
	.asked { margin: 0 0 8px; }
	.answer { white-space: pre-wrap; }
	.cites { margin: 10px 0 0; font-size: 12px; display: flex; gap: 10px; flex-wrap: wrap; }
	.stamp { margin: 6px 0 0; font: 11px var(--mono); }
	.problem { margin: 0; color: var(--bad); }
	.refusal { margin: 4px 0 0; font-size: 13px; }
	.badge {
		font: 11px var(--mono);
		font-weight: 700;
		background: var(--bad);
		color: #fff;
		border-radius: 4px;
		padding: 1px 5px;
	}
	.history { max-height: 400px; overflow: auto; font: 12px/1.5 var(--mono); white-space: pre-wrap; }
	.small { font-size: 12px; }
	code { font: 11px var(--mono); background: var(--soft); border-radius: 4px; padding: 1px 5px; }
</style>
