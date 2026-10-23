<script lang="ts">
	/**
	 * The Study index: every subject as a card, and a form for a new subject.
	 * Each card's Edit and Delete are the shared `EditDetails`, as on every
	 * module's list; a subject's own pages only show them.
	 */
	import { goto, invalidateAll } from '$app/navigation';
	import EditDetails from '$lib/components/EditDetails.svelte';
	import { api, saveSubject } from '$lib/client/api';

	let { data } = $props();

	let name = $state('');
	let folders = $state('');
	let saving = $state(false);
	let problem = $state('');

	/** Reload once a write has gone through, and hand its result back either way. */
	async function reloaded<T extends { ok: boolean }>(result: T): Promise<T> {
		if (result.ok) await invalidateAll();
		return result;
	}

	/** Start a session on the subject the card names, and go straight to it. */
	async function startNow(slug: string) {
		saving = true;
		problem = '';
		const result = await api('/api/study/session', { action: 'start', subject: slug });
		if (result.ok) await goto('/focus', { invalidateAll: true });
		else {
			problem = result.message;
			saving = false;
		}
	}

	async function create(event: Event) {
		event.preventDefault();
		if (!name.trim() || saving) return;
		saving = true;
		problem = '';
		const extra = folders.split(',').map((f) => f.trim()).filter(Boolean);
		const result = await api<{ subject: { slug: string } }>('/api/study/subject', { name: name.trim(), folders: extra });
		saving = false;
		if (result.ok) await goto(`/study/${result.value.subject.slug}`, { invalidateAll: true });
		else problem = result.message;
	}
</script>

<svelte:head><title>Study · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Study</h1>
		<p>One subject per thing you are learning, each with its own goals and reading.</p>
	</div>

	{#if data.now}
		{@const now = data.now}
		<section class="sheet next" data-testid="study-now">
			<p class="caps"><i class="dot" style="--dot: {now.color}"></i>{now.running ? 'Running now' : now.at !== null ? `Next block, ${String(Math.floor(now.at / 60)).padStart(2, '0')}:${String(now.at % 60).padStart(2, '0')}` : 'Next block'} · {now.name} · {now.minutes} min</p>
			<h2>{now.step ?? 'Nothing open here yet'}</h2>
			{#if now.running}
				<a class="btn primary" href="/focus" data-testid="study-now-go">Continue</a>
			{:else if now.step}
				<button class="btn primary" disabled={saving} onclick={() => startNow(now.slug)} data-testid="study-now-go">Start</button>
				<a class="small" href="/study/{now.slug}">See the step</a>
			{:else}
				<a class="btn primary" href="/study/{now.slug}/plan" data-testid="study-now-go">Plan it</a>
			{/if}
		</section>
	{/if}

	<p class="label">Subjects</p>
	{#if data.subjects.length === 0}
		<p class="empty">No subjects yet. Start one below.</p>
	{:else}
		<div class="subjects">
			{#each data.subjects as subject (subject.slug)}
				<div class="sheet subject" data-testid="subject-card">
					<h2><i class="dot" style="--dot: {subject.color}"></i><a class="stretch" href="/study/{subject.slug}">{subject.name}</a></h2>
					{#if subject.description}<p class="muted small desc">{subject.description}</p>{/if}
					{#if subject.goals.length}
						<ul class="goals">
							{#each subject.goals.slice(0, 4) as goal (goal.name)}
								<li><span>{goal.name}</span><span class="num muted">{goal.done}/{goal.total}</span></li>
							{/each}
							{#if subject.goals.length > 4}<li class="muted">and {subject.goals.length - 4} more</li>{/if}
						</ul>
					{:else}
						<p class="muted small">No goals yet.</p>
					{/if}
					<div class="own small">
						<EditDetails
							details={subject}
							fields={['name', 'description', 'color', 'tag']}
							fileHref={subject.fileHref}
							save={async (changed) => reloaded(await saveSubject(subject.slug, changed))}
							remove={async () => reloaded(await api('/api/study/subject', { subject: subject.slug }, { method: 'DELETE' }))}
							ask="Delete this subject? Only its file in _hub/subjects goes; its folder and notes stay."
						/>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<p class="label">New subject</p>
	<form class="row" onsubmit={create} data-testid="new-subject">
		<input class="field name" bind:value={name} placeholder="Filipino" aria-label="Subject name" data-testid="subject-name" />
		<input class="field folders" bind:value={folders} placeholder="Reference folders, comma separated (optional)" aria-label="Reference folders" data-testid="subject-folders" />
		<button class="btn primary" disabled={!name.trim() || saving} data-testid="create-subject">{saving ? 'Creating…' : 'Create'}</button>
	</form>
	<p class="hint">Files go in <code>Study/{name.trim() || '<name>'}</code>.</p>
	{#if problem}<p class="problem" role="status">{problem}</p>{/if}
</div>

<style>
	.next { margin-bottom: var(--s5); }
	.next .caps { margin: 0 0 var(--s2); color: var(--muted); font-size: var(--t13); display: flex; align-items: center; gap: var(--s2); }
	.next h2 { margin: 0 0 var(--s3); font: 600 var(--t20)/1.35 var(--serif); }

	.subjects { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--s4); }
	/* The whole card opens the subject, through its name's link stretched over
	   it. */
	.subject { position: relative; display: flex; flex-direction: column; gap: var(--s2); color: var(--text); }
	.subject:hover { border-color: var(--accent); }
	.stretch { color: inherit; }
	.stretch::after { content: ''; position: absolute; inset: 0; }
	.stretch:hover { text-decoration: none; }
	/* A card being edited takes the whole row, so its form has room. */
	.subject:has(:global(form)) { grid-column: 1 / -1; }
	.subject:has(:global(form)):hover { border-color: var(--line); }
	.desc { margin: 0; }
	.own { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); margin: 0; }
	.subject h2 { margin: 0; display: flex; align-items: center; gap: var(--s2); font: 600 var(--t16) var(--serif); }
	.goals { list-style: none; margin: 0; padding: 0; font-size: var(--t13); display: flex; flex-direction: column; gap: 2px; }
	.goals li { display: flex; justify-content: space-between; gap: var(--s2); }

	.row { display: flex; flex-wrap: wrap; gap: var(--s2); }
	.row .name { flex: 1; min-width: 160px; }
	.row .folders { flex: 2; min-width: 200px; }
	.hint { margin-top: var(--s2); }
</style>
