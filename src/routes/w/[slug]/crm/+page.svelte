<script lang="ts">
	/**
	 * A workspace's CRM: its contacts, filtered by kind and searched by name,
	 * company or role, most recent interaction first — the order the server
	 * sent, which the filters only ever narrow.
	 *
	 * "New contact" creates the note and opens it, so the next thing you do,
	 * adding what just happened, is on the page you land on.
	 */
	import { goto } from '$app/navigation';
	import { api } from '$lib/client/api';
	import { relativeDay } from '$lib/shared/links';

	let { data } = $props();

	let kind = $state<string | null>(null);
	let query = $state('');

	/** The offered kinds, then any other a hand-written note uses, so every contact can be filtered to. */
	const kinds = $derived([
		...data.kinds,
		...new Set(data.contacts.map((c) => c.kind).filter((k): k is string => !!k && !data.kinds.includes(k)))
	]);

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return data.contacts.filter(
			(c) =>
				(kind === null || c.kind === kind) &&
				(!q || [c.name, c.company, c.role].some((field) => field?.toLowerCase().includes(q)))
		);
	});

	const href = (name: string) => `/w/${data.workspace.slug}/crm/${encodeURIComponent(name)}`;

	let adding = $state(false);
	let saving = $state(false);
	let problem = $state('');
	let form = $state({ name: '', kind: 'lead', company: '', role: '', email: '', phone: '', notes: '' });

	async function create(event: Event) {
		event.preventDefault();
		if (saving || !form.name.trim()) return;
		saving = true;
		problem = '';
		const { name, notes, ...details } = form;
		const result = await api<{ contact: { name: string } }>('/api/crm', { workspace: data.workspace.slug, name, ...details, notes });
		saving = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		await goto(href(result.value.contact.name));
	}
</script>

<div class="toolbar">
	<input class="field search" type="search" placeholder="Search name, company or role" bind:value={query} aria-label="Search contacts" data-testid="crm-search" />
	{#if !adding}
		<button class="btn primary" onclick={() => (adding = true)} data-testid="crm-new">New contact</button>
	{/if}
</div>

{#if adding}
	<p class="label">New contact</p>
	<form class="sheet new" onsubmit={create} data-testid="crm-new-form">
		<input class="field wide" placeholder="Name, as you would link to it" bind:value={form.name} aria-label="Name" data-testid="crm-new-name" required />
		<select class="field" bind:value={form.kind} aria-label="Kind" data-testid="crm-new-kind">
			{#each data.kinds as k (k)}<option value={k}>{k}</option>{/each}
		</select>
		<input class="field" placeholder="Company" bind:value={form.company} aria-label="Company" data-testid="crm-new-company" />
		<input class="field" placeholder="Role" bind:value={form.role} aria-label="Role" />
		<input class="field" type="email" placeholder="Email" bind:value={form.email} aria-label="Email" />
		<input class="field" type="tel" placeholder="Phone" bind:value={form.phone} aria-label="Phone" />
		<textarea class="field wide" placeholder="Notes (optional)" bind:value={form.notes} aria-label="Notes"></textarea>
		<div class="actions wide">
			<button class="btn primary" type="submit" disabled={saving || !form.name.trim()} data-testid="crm-new-submit">
				{saving ? 'Creating…' : 'Create contact'}
			</button>
			<button class="btn ghost" type="button" onclick={() => { adding = false; problem = ''; }}>Cancel</button>
		</div>
		{#if problem}<p class="problem wide">{problem}</p>{/if}
	</form>
{/if}

<p class="label">
	Contacts
	<span class="right">{shown.length === data.contacts.length ? data.contacts.length : `${shown.length} of ${data.contacts.length}`}</span>
</p>
{#if data.contacts.length}
	<div class="chips kinds" role="group" aria-label="Filter by kind">
		<button class="chip" class:on={kind === null} aria-pressed={kind === null} onclick={() => (kind = null)}>All</button>
		{#each kinds as k (k)}
			<button class="chip" class:on={kind === k} aria-pressed={kind === k} onclick={() => (kind = kind === k ? null : k)} data-testid="crm-kind">{k}</button>
		{/each}
	</div>
{/if}

<div class="sheet rows" data-testid="crm-list">
	{#each shown as c (c.path)}
		<a class="contact" href={href(c.name)} data-testid="crm-row">
			<span class="who">
				<b>{c.name}</b>
				{#if c.kind}<span class="badge">{c.kind}</span>{/if}
				{#if c.company || c.role}<span class="muted small">{[c.role, c.company].filter(Boolean).join(' · ')}</span>{/if}
			</span>
			<span class="when muted small num">
				{#if c.lastInteraction}{relativeDay(c.lastInteraction, data.today)} · {c.interactions} {c.interactions === 1 ? 'entry' : 'entries'}{:else}no history yet{/if}
			</span>
		</a>
	{:else}
		<p class="none">
			{#if data.contacts.length}Nobody matches.{:else}No contacts yet. Each one is a note in this workspace's <code>CRM/</code> folder.{/if}
		</p>
	{/each}
</div>

<style>
	.toolbar { display: flex; gap: var(--s2); align-items: center; }
	.toolbar .search { flex: 1; min-width: 0; }
	.toolbar .btn { flex: none; }

	.new { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--s3); }
	.new .wide { grid-column: 1 / -1; }
	.actions { display: flex; gap: var(--s2); }
	.new .problem { margin: 0; }

	.kinds { margin-bottom: var(--s3); }
	.kinds .chip { text-transform: capitalize; }

	.contact { display: flex; justify-content: space-between; align-items: baseline; gap: var(--s3); color: var(--text); }
	.contact:hover { text-decoration: none; }
	.contact:hover b { color: var(--accent); }
	.who { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s1) var(--s2); min-width: 0; }
	.when { flex: none; text-align: right; }

	/* A phone: one column of fields, and a row's date under its name. */
	@media (max-width: 720px) {
		.new { grid-template-columns: 1fr; }
		.contact { flex-direction: column; gap: 2px; }
		.when { text-align: left; }
	}
</style>
