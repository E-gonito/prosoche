<script lang="ts">
	/**
	 * One contact: details you can edit, notes to read, and the history with a
	 * box to add to it.
	 *
	 * Saving the details sends only the fields that changed, and each becomes a
	 * span edit of its own frontmatter lines; adding an entry inserts one line
	 * under `## History`. Both carry the hash this page loaded, so a note
	 * changed in Obsidian meanwhile is refused and reloaded rather than
	 * overwritten, and what was typed stays in the form.
	 */
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/client/api';

	/** A contact's details as the form sends them. Links are one per item; an empty value clears. */
	type ContactDetails = { kind?: string; company?: string; role?: string; email?: string; phone?: string; links?: string[] };
	import { noteHref, relativeDay } from '$lib/shared/links';

	let { data } = $props();
	const c = $derived(data.contact);

	const FIELDS = [
		{ key: 'company', label: 'Company', type: 'text' },
		{ key: 'role', label: 'Role', type: 'text' },
		{ key: 'email', label: 'Email', type: 'email' },
		{ key: 'phone', label: 'Phone', type: 'tel' }
	] as const;

	/** The kinds to offer: the usual three, and this contact's own when it is something else. */
	const kinds = $derived(c.kind && !data.kinds.includes(c.kind) ? [...data.kinds, c.kind] : data.kinds);

	let editing = $state(false);
	let saving = $state(false);
	let problem = $state('');
	let draft = $state({ kind: '', company: '', role: '', email: '', phone: '', links: '' });

	function edit() {
		draft = { kind: c.kind ?? '', company: c.company ?? '', role: c.role ?? '', email: c.email ?? '', phone: c.phone ?? '', links: c.links.join('\n') };
		problem = '';
		editing = true;
	}

	/** Only what differs from the note as loaded, so an untouched field's bytes are never rewritten. */
	function changes(): ContactDetails {
		const out: ContactDetails = {};
		for (const key of ['kind', 'company', 'role', 'email', 'phone'] as const) {
			if (draft[key].trim() !== (c[key] ?? '')) out[key] = draft[key];
		}
		const links = draft.links.split(/\s+/).filter(Boolean);
		if (links.join('\n') !== c.links.join('\n')) out.links = links;
		return out;
	}

	async function save(event: Event) {
		event.preventDefault();
		if (saving) return;
		const fields = changes();
		if (!Object.keys(fields).length) {
			editing = false;
			return;
		}
		saving = true;
		problem = '';
		const result = await api('/api/crm', { workspace: data.workspace.slug, name: c.name, expectedHash: c.hash, fields }, { method: 'PATCH' });
		saving = false;
		if (!result.ok) {
			problem = result.message;
			if (result.kind === 'conflict') await invalidateAll();
			return;
		}
		editing = false;
		await invalidateAll();
	}

	// Seeded once; after an entry is added the day stays where it was, so a
	// run of back-dated entries does not keep jumping back to today.
	// svelte-ignore state_referenced_locally
	let day = $state(data.today);
	let text = $state('');
	let adding = $state(false);
	let entryProblem = $state('');

	async function addEntry(event: Event) {
		event.preventDefault();
		if (adding || !text.trim()) return;
		adding = true;
		entryProblem = '';
		const result = await api('/api/crm', { workspace: data.workspace.slug, name: c.name, expectedHash: c.hash, entry: { day, text } }, { method: 'PATCH' });
		adding = false;
		if (!result.ok) {
			entryProblem = result.message;
			if (result.kind === 'conflict') await invalidateAll();
			return;
		}
		text = '';
		await invalidateAll();
	}

	const isUrl = (link: string) => /^https?:\/\//i.test(link);
</script>

<svelte:head><title>{c.name} · {data.workspace.name} · prosoche</title></svelte:head>

<a class="crumb" href="/w/{data.workspace.slug}/crm">← All contacts</a>
<div class="head">
	<h2>{c.name}</h2>
	{#if c.kind}<span class="badge" data-testid="crm-kind-badge">{c.kind}</span>{/if}
</div>
<p class="sub muted">
	{#if c.role || c.company}{[c.role, c.company].filter(Boolean).join(' · ')} · {/if}
	{#if c.lastInteraction}Last {relativeDay(c.lastInteraction, data.today)}{:else}No history yet{/if}
	· <a href={noteHref(c.path)}>open the note</a>
</p>

<p class="label">
	Details
	{#if !editing}<span class="right"><button class="btn small" onclick={edit} data-testid="crm-edit">Edit</button></span>{/if}
</p>
{#if editing}
	<form class="sheet details-form" onsubmit={save} data-testid="crm-details-form">
		<label>
			<span>Kind</span>
			<select class="field" bind:value={draft.kind} data-testid="crm-field-kind">
				<option value="">—</option>
				{#each kinds as k (k)}<option value={k}>{k}</option>{/each}
			</select>
		</label>
		{#each FIELDS as f (f.key)}
			<label>
				<span>{f.label}</span>
				<input class="field" type={f.type} bind:value={draft[f.key]} data-testid="crm-field-{f.key}" />
			</label>
		{/each}
		<label class="wide">
			<span>Links, one per line</span>
			<textarea class="field" bind:value={draft.links} rows="3" data-testid="crm-field-links"></textarea>
		</label>
		<div class="actions wide">
			<button class="btn primary" type="submit" disabled={saving} data-testid="crm-save">{saving ? 'Saving…' : 'Save'}</button>
			<button class="btn ghost" type="button" onclick={() => (editing = false)}>Cancel</button>
		</div>
		{#if problem}<p class="problem wide">{problem}</p>{/if}
	</form>
{:else}
	<div class="kv details" data-testid="crm-details">
		<b>Kind</b><span>{c.kind ?? '—'}</span>
		<b>Company</b><span>{c.company ?? '—'}</span>
		<b>Role</b><span>{c.role ?? '—'}</span>
		<b>Email</b><span>{#if c.email}<a href="mailto:{c.email}">{c.email}</a>{:else}—{/if}</span>
		<b>Phone</b><span>{#if c.phone}<a href="tel:{c.phone.replace(/[^\d+]/g, '')}">{c.phone}</a>{:else}—{/if}</span>
		<b>Links</b>
		<span class="links">
			{#each c.links as link (link)}
				{#if isUrl(link)}<a href={link} target="_blank" rel="noopener noreferrer">{link}</a>{:else}<span>{link}</span>{/if}
			{:else}—{/each}
		</span>
	</div>
{/if}

{#if data.html}
	<p class="label">Notes</p>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	<div class="sheet prose" data-testid="crm-notes">{@html data.html}</div>
{/if}

<p class="label">History <span class="right">{c.history.length}</span></p>
<form class="add-entry" onsubmit={addEntry}>
	<input class="field day" type="date" bind:value={day} aria-label="Date" data-testid="crm-entry-day" />
	<input class="field text" placeholder="What happened?" bind:value={text} aria-label="What happened" data-testid="crm-entry-text" />
	<button class="btn primary" type="submit" disabled={adding || !text.trim()} data-testid="crm-entry-add">{adding ? 'Adding…' : 'Add entry'}</button>
</form>
{#if entryProblem}<p class="problem">{entryProblem}</p>{/if}

<div class="sheet rows history" data-testid="crm-history">
	{#each c.history as h (h.line)}
		<div class="entry" data-testid="crm-history-entry">
			<span class="when num">{h.day ?? 'undated'}</span>
			<span>{h.text}</span>
		</div>
	{:else}
		<p class="none">Nothing yet. Add the first call, email or meeting above.</p>
	{/each}
</div>

<style>
	.crumb { font-size: var(--t13); color: var(--muted); display: inline-block; margin-bottom: var(--s1); }
	.head { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
	.head h2 { font-size: var(--t24); margin: 0; }
	.sub { margin: var(--s1) 0 0; font-size: var(--t14); }

	.details { overflow-wrap: anywhere; }
	.links { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

	.details-form { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--s3); }
	.details-form label { display: flex; flex-direction: column; gap: var(--s1); font-size: var(--t13); color: var(--muted); }
	.details-form .wide { grid-column: 1 / -1; }
	.actions { display: flex; gap: var(--s2); }
	.details-form .problem { margin: 0; }

	.add-entry { display: flex; gap: var(--s2); margin-bottom: var(--s3); }
	.add-entry .day { flex: none; width: auto; }
	.add-entry .text { flex: 1; min-width: 0; }
	.add-entry .btn { flex: none; }

	.entry { display: flex; gap: var(--s3); align-items: baseline; font-size: var(--t14); }
	.entry .when { flex: none; min-width: 90px; font-weight: 600; }

	/* A phone: one column of fields, the entry box stacked, and a narrower label column. */
	@media (max-width: 720px) {
		.details-form { grid-template-columns: 1fr; }
		.details { grid-template-columns: 90px 1fr; }
		.add-entry { flex-wrap: wrap; }
		.add-entry .text { flex-basis: 100%; order: -1; }
		.entry { flex-direction: column; gap: 2px; }
	}
</style>
