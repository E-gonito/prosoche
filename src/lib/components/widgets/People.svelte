<script lang="ts">
	/**
	 * The people of a workspace, the ones needing attention first.
	 *
	 * The ordering is the server's; this renders it and offers the one action
	 * that belongs in a list: logging that you spoke to someone. It writes
	 * through the same endpoint the person's own page uses, so there is one
	 * code path and the answer is a refreshed list rather than a navigation.
	 */
	import { invalidateAll } from '$app/navigation';
	import Unavailable from './Unavailable.svelte';
	import { logContact } from '$lib/client/api';
	import type { LoadedWidget } from '$lib/shared/widgets';

	interface Person {
		name: string;
		path: string | null;
		lastContact: string | null;
		openFollowUps: number;
		nextDue: string | null;
		mentions: number;
		role: string | null;
		org: string | null;
	}
	interface Data {
		people: Person[];
		today: string;
		folder: string;
		scope: string | null;
	}

	let { widget, refresh }: { widget: LoadedWidget; refresh?: () => void } = $props();

	const data = $derived(widget.data as Data | null);
	let logging = $state<string | null>(null);
	let problem = $state<string | null>(null);
	let text = $state('');
	let busy = $state(false);

	const href = (name: string) => `/people/${encodeURIComponent(name)}`;

	/** Days between two `YYYY-MM-DD` labels, as whole days, never an instant. */
	function daysBetween(from: string, to: string): number {
		const [a, b] = [from, to].map((d) => {
			const [y, m, day] = d.split('-').map(Number);
			return Date.UTC(y, m - 1, day);
		});
		return Math.round((b - a) / 86_400_000);
	}

	function ago(day: string | null, today: string): string {
		if (!day) return 'no contact yet';
		const days = daysBetween(day, today);
		if (days <= 0) return 'today';
		if (days === 1) return 'yesterday';
		if (days < 14) return `${days} days ago`;
		if (days < 60) return `${Math.round(days / 7)} weeks ago`;
		return day;
	}

	/**
	 * Logging from the list refreshes the list rather than navigating: the
	 * answer to "I spoke to them" is that they move down it, not that you are
	 * suddenly on their page.
	 */
	async function log(name: string) {
		if (busy) return;
		busy = true;
		problem = null;
		const result = await logContact(name, text);
		busy = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		text = '';
		logging = null;
		await invalidateAll();
		refresh?.();
	}
</script>

{#if !data}
	<Unavailable {widget} />
{:else if !data.people.length}
	<p class="empty-note">
		No people {data.scope ? `in ${data.scope}` : 'yet'}. A person is a note in
		<code>{data.folder}/</code>; mention someone with a wiki-link and log a contact from their page to
		create one.
	</p>
{:else}
	<ul class="people" data-testid="people-widget">
		{#each data.people as p (p.name)}
			<li class="person" data-testid="person-row">
				<a class="name" href={href(p.name)}>{p.name}</a>
				{#if p.role || p.org}
					<span class="who">{[p.role, p.org].filter(Boolean).join(' · ')}</span>
				{/if}
				<span class="when">{ago(p.lastContact, data.today)}</span>
				{#if p.openFollowUps}
					<a class="badge" href={href(p.name)} title="Open follow-ups">
						{p.openFollowUps}{#if p.nextDue}<span class="due"> · {p.nextDue}</span>{/if}
					</a>
				{/if}
				<button
					class="log"
					data-testid="log-contact"
					onclick={() => (logging = logging === p.name ? null : p.name)}
					aria-expanded={logging === p.name}
				>Log</button>

				{#if logging === p.name}
					<form class="entry" onsubmit={(e) => { e.preventDefault(); void log(p.name); }}>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							bind:value={text}
							autofocus
							placeholder="What did you talk about?"
							aria-label="What you talked about with {p.name}"
							data-testid="log-text"
						/>
						<button class="btn primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
	{#if problem}<p class="problem">{problem}</p>{/if}
{/if}

<style>
	.people { list-style: none; margin: 0; padding: 0; }
	.person {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		padding: 7px 2px;
		border-top: 1px solid var(--line);
	}
	.person:first-child { border-top: 0; }
	.name { font-weight: 600; text-decoration: none; }
	.name:hover { text-decoration: underline; }
	.who { font-size: 12px; color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.when { margin-left: auto; font-size: 12px; color: var(--muted); }
	.badge {
		font: 11px var(--mono);
		color: var(--accent);
		background: var(--accent-soft);
		border-radius: 999px;
		padding: 2px 8px;
		text-decoration: none;
	}
	.due { color: var(--muted); }
	.log {
		border: 1px solid var(--line);
		background: #fff;
		border-radius: 8px;
		font: inherit;
		font-size: 12px;
		padding: 2px 9px;
		cursor: pointer;
		color: var(--muted);
	}
	.log:hover { color: var(--accent); border-color: var(--accent); }
	.entry { flex: 1 0 100%; display: flex; gap: 6px; padding: 4px 0 2px; }
	.entry input {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 13px;
		padding: 5px 9px;
		border: 1px solid var(--line);
		border-radius: 8px;
	}
	.empty-note { margin: 0; color: var(--muted); font-size: 13px; }
	.empty-note code { font: 12px var(--mono); background: var(--soft); border-radius: 4px; padding: 1px 5px; }
	.problem { margin: 8px 0 0; font-size: 12px; color: var(--bad); }

	@media (max-width: 720px) {
		.who { display: none; }
		.when { flex-basis: 100%; margin-left: 0; }
	}
</style>
