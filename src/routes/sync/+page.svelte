<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Confirm from '$lib/components/Confirm.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let { data } = $props();

	type Pending = { path: string; status: string; byApp: boolean };

	let selected = $state(new Set<string>());
	let message = $state('');
	let busy = $state('');
	let note = $state('');
	let problem = $state('');
	let diff = $state<{ path: string; diff: string } | null>(null);
	let asking = $state<'commit' | 'discard' | null>(null);

	const chosen = $derived(data.files.filter((f: Pending) => selected.has(f.path)));
	const allSelected = $derived(data.files.length > 0 && chosen.length === data.files.length);

	function toggle(path: string) {
		const next = new Set(selected);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		selected = next;
	}

	function toggleAll() {
		selected = allSelected ? new Set() : new Set(data.files.map((f: Pending) => f.path));
	}

	async function send(action: string, body: Record<string, unknown> = {}) {
		busy = action;
		note = '';
		problem = '';
		try {
			const res = await fetch('/api/sync', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action, ...body })
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok || result.error) problem = result.error ?? `Failed (${res.status})`;
			return result;
		} catch (e) {
			problem = e instanceof Error ? e.message : String(e);
			return null;
		} finally {
			busy = '';
		}
	}

	async function doCommit() {
		asking = null;
		const paths = chosen.map((f: Pending) => f.path);
		const result = await send('commit', { paths, message });
		if (result && !problem) {
			note = `Committed and pushed ${paths.length} file${paths.length === 1 ? '' : 's'}.`;
			selected = new Set();
			message = '';
			await invalidateAll();
		}
	}

	async function doDiscard() {
		asking = null;
		const paths = chosen.map((f: Pending) => f.path);
		const result = await send('discard', { paths });
		if (result && !problem) {
			note = `Discarded ${result.discarded?.length ?? 0} file${result.discarded?.length === 1 ? '' : 's'}. A copy of each is in ${result.snapshot}.`;
			selected = new Set();
			await invalidateAll();
		}
	}

	async function simple(action: 'pull' | 'push' | 'rebuild') {
		const result = await send(action);
		if (result && !problem) {
			note = action === 'rebuild' ? `Index rebuilt in ${result.tookMs} ms.` : `${action} finished.`;
			await invalidateAll();
		}
	}

	async function showDiff(path: string) {
		busy = `diff:${path}`;
		try {
			const res = await fetch(`/api/sync/diff?path=${encodeURIComponent(path)}`);
			diff = res.ok ? await res.json() : null;
		} finally {
			busy = '';
		}
	}

	async function inspectConflict(path: string) {
		busy = `conflict:${path}`;
		try {
			const res = await fetch(`/api/sync/conflict?path=${encodeURIComponent(path)}`);
			conflict = res.ok ? await res.json() : null;
		} finally {
			busy = '';
		}
	}

	let conflict = $state<{ path: string; mine: string; theirs: string } | null>(null);

	const when = (at: Date | string | null) => (at ? new Date(at).toLocaleString('en-GB') : 'never');
	const label: Record<string, string> = {
		modified: 'changed',
		added: 'added',
		deleted: 'deleted',
		untracked: 'new',
		renamed: 'renamed'
	};
</script>

<svelte:head><title>Sync · prosoche</title></svelte:head>

<PageHeader title="Sync">
	{#snippet meta()}
		<span class="path">{data.vaultPath}</span>
	{/snippet}
	{#snippet actions()}
		<button class="btn" onclick={() => simple('pull')} disabled={!!busy}>{busy === 'pull' ? 'Pulling…' : 'Pull'}</button>
		<button class="btn" onclick={() => simple('rebuild')} disabled={!!busy}>
			{busy === 'rebuild' ? 'Rebuilding…' : 'Rebuild index'}
		</button>
	{/snippet}
</PageHeader>

{#if note}<div class="card msg ok">{note}</div>{/if}
{#if problem}<div class="card msg bad">{problem}</div>{/if}

<div class="grid">
	<div class="card">
		<h3>
			Local changes
			<span class="right">{data.files.length} file{data.files.length === 1 ? '' : 's'}</span>
		</h3>

		{#if data.files.length === 0}
			<p class="hint">Nothing to commit. Everything on this server matches the last push.</p>
		{:else}
			<div class="pick">
				<label class="row all">
					<input type="checkbox" checked={allSelected} onchange={toggleAll} />
					<span>{allSelected ? 'Deselect all' : 'Select all'}</span>
				</label>

				{#each data.files as file (file.path)}
					<label class="row">
						<input type="checkbox" checked={selected.has(file.path)} onchange={() => toggle(file.path)} />
						<span class="path">{file.path}</span>
						<span class="tag">{label[file.status] ?? file.status}</span>
						{#if file.byApp}<span class="tag by">by prosoche</span>{/if}
						<button
							class="btn ghost small"
							onclick={(e) => { e.preventDefault(); void showDiff(file.path); }}
							disabled={busy === `diff:${file.path}`}
						>
							{busy === `diff:${file.path}` ? '…' : 'diff'}
						</button>
					</label>
				{/each}
			</div>

			<input
				class="subject"
				bind:value={message}
				placeholder="Commit message (optional)"
				aria-label="Commit message"
			/>

			<div class="row buttons">
				<button class="btn primary" disabled={!chosen.length || !!busy} onclick={() => (asking = 'commit')}>
					Commit and push {chosen.length || ''}
				</button>
				<button class="btn danger" disabled={!chosen.length || !!busy} onclick={() => (asking = 'discard')}>
					Discard {chosen.length || ''}
				</button>
			</div>
			<p class="hint">Discarding reverts to the last commit; a copy is saved to <code>{data.undoPath}</code> first.</p>
		{/if}
	</div>

	<div class="card">
		<h3>Git <span class="right">{data.status.provider}</span></h3>
		<div class="kv">
			<b>branch</b><span>{data.branch}</span>
			<b>last pull</b><span>{when(data.status.lastPull)}</span>
			<b>last push</b><span>{when(data.status.lastPush)}</span>
			<b>diverged</b><span>{data.status.ahead} ahead, {data.status.behind} behind</span>
			<b>schedule</b>
			<span>
				pull every {data.pullIntervalMinutes} min; changes this app makes are committed
				{data.commitDebounceMinutes} min after the last save
			</span>
		</div>
		{#if data.status.error}<p class="err">{data.status.error}</p>{/if}
		<p class="hint">Automatic commits only stage files this app wrote; your own edits wait here.</p>
	</div>

	<div class="card">
		<h3>Index</h3>
		<div class="kv">
			<b>notes</b><span>{data.health.notes}</span>
			<b>tasks</b><span>{data.health.tasks}</span>
			<b>links</b><span>{data.health.links}</span>
			<b>tags</b><span>{data.health.tags}</span>
			<b>last build</b><span>{data.health.lastBuildMs ?? '—'} ms</span>
		</div>
	</div>

	{#if data.status.conflicts.length}
		<div class="card bad-card">
			<h3>Conflicts</h3>
			<p class="hint">Pushing is paused until these are resolved.</p>
			{#each data.status.conflicts as file (file)}
				<div class="row">
					<span class="path">{file}</span>
					<button class="btn small" onclick={() => inspectConflict(file)}>Compare</button>
				</div>
			{/each}
			<p class="hint">Your working copy is intact; compare the two versions and commit what you choose.</p>
			<p class="commands">
				<code>git rebase origin/{data.branch}</code> or <code>git reset --hard origin/{data.branch}</code>
			</p>
		</div>
	{/if}

	{#if data.health.problems.length}
		<div class="card">
			<h3>Notes the parser could not read</h3>
			<ul class="files">{#each data.health.problems as p (p.path)}<li>{p.path} — {p.message}</li>{/each}</ul>
		</div>
	{/if}

	{#if diff}
		<div class="card wide">
			<h3>
				{diff.path}
				<span class="right"><button class="btn ghost" onclick={() => (diff = null)}>Close</button></span>
			</h3>
			<pre class="diff">{diff.diff}</pre>
		</div>
	{/if}

	{#if conflict}
		<div class="card wide">
			<h3>
				{conflict.path}
				<span class="right"><button class="btn ghost" onclick={() => (conflict = null)}>Close</button></span>
			</h3>
			<div class="two-up">
				<div><h4>On this server</h4><pre>{conflict.mine || '(not present)'}</pre></div>
				<div><h4>On the remote</h4><pre>{conflict.theirs || '(not present)'}</pre></div>
			</div>
		</div>
	{/if}
</div>

{#if asking === 'commit'}
	<Confirm
		title="Commit and push {chosen.length} file{chosen.length === 1 ? '' : 's'}?"
		body="These go to the remote on branch {data.branch}. Nothing else is staged."
		items={chosen.map((f) => f.path)}
		confirmLabel="Commit and push"
		onconfirm={doCommit}
		oncancel={() => (asking = null)}
	/>
{:else if asking === 'discard'}
	<Confirm
		title="Discard changes to {chosen.length} file{chosen.length === 1 ? '' : 's'}?"
		body="This puts them back to the last commit and cannot be undone from git. A copy of each is saved to {data.undoPath} first."
		items={chosen.map((f) => f.path)}
		confirmLabel="Discard them"
		danger
		onconfirm={doDiscard}
		oncancel={() => (asking = null)}
	/>
{/if}

<style>
	.path { font: 12px var(--mono); }
	.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; align-items: start; }
	.msg { margin-bottom: 14px; }
	.msg.ok { border-color: #a7f3d0; background: #f0fdf4; }
	.msg.bad { border-color: #fca5a5; background: #fff7f7; }
	.err { color: var(--bad); font-size: 13px; margin: 10px 0 0; }
	.bad-card { border-color: #fca5a5; background: #fff7f7; }

	.pick { border: 1px solid var(--line); border-radius: 8px; max-height: 320px; overflow: auto; margin-bottom: 10px; }
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		border-top: 1px solid var(--line);
		font: 12px var(--mono);
	}
	.pick .row:first-child { border-top: 0; }
	.row.all { background: var(--soft); font-family: inherit; font-size: 13px; }
	.row .path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tag.by { background: var(--accent-soft); color: var(--accent); }
	label.row { cursor: pointer; }
	.small { padding: 2px 8px; font-size: 11px; }

	.subject { width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 13px; }
	.buttons { border: 0; padding: 10px 0 0; justify-content: flex-start; font-family: inherit; }
	.danger { background: var(--bad); border-color: var(--bad); color: #fff; }
	.danger:hover:not(:disabled) { background: #a11414; }
	.danger:disabled { opacity: 0.45; }

	.wide { grid-column: 1 / -1; }
	.diff, .two-up pre {
		margin: 0;
		max-height: 440px;
		overflow: auto;
		background: var(--soft);
		padding: 10px;
		border-radius: 8px;
		font-size: 12px;
		white-space: pre-wrap;
	}
	.two-up { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
	.two-up h4 { margin: 0 0 6px; font-size: 12px; color: var(--muted); }
	.files { margin: 0; padding-left: 18px; font: 12px var(--mono); }
	.commands { margin: 4px 0 0; }
	.commands code { font: 11px var(--mono); background: var(--soft); border-radius: 4px; padding: 1px 5px; }
	@media (max-width: 900px) { .two-up { grid-template-columns: 1fr; } }
</style>
