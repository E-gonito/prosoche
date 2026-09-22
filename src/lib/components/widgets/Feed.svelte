<script lang="ts">
	/**
	 * One integration's rows, or the reason there are none.
	 *
	 * GitHub and Linear render through this single component because the
	 * modules behind them return the same neutral shape. The not-connected
	 * state is the one that ships until a token exists, so it is treated as a
	 * first-class view: it names the environment variables, says what each is
	 * for, and does not pretend to be an error.
	 */
	import { issueCardLine, issueCardText, type IntegrationItem, type IntegrationWidget } from '$lib/shared/integrations';
	import { createCard } from '$lib/client/cards';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import type { LoadedWidget } from '$lib/shared/widgets';

	let { widget }: { widget: LoadedWidget; refresh?: () => void } = $props();
	const data = $derived(widget.data as IntegrationWidget);
	const feed = $derived(data.feed);

	/** The row that was just acted on, and what happened to it. */
	let said = $state({ id: '', message: '' });
	let busy = $state('');

	/**
	 * Make a card from a row.
	 *
	 * Appending to the deck belongs to the board's writer, so that is what
	 * runs when the tab has a workspace. A tab with no workspace has no deck
	 * to append to, and rather than refuse, the same line goes on the
	 * clipboard for the user to paste wherever it belongs.
	 */
	async function makeCard(item: IntegrationItem) {
		if (busy) return;
		busy = item.id;
		if (data.slug) {
			const result = await createCard({ workspace: data.slug, text: issueCardText(item), quadrant: 2 });
			said = { id: item.id, message: result.ok ? `Card added to ${result.value.path}` : result.message };
		} else {
			try {
				await navigator.clipboard.writeText(issueCardLine(item, ''));
				said = { id: item.id, message: 'Card line copied. Paste it into a deck.' };
			} catch {
				said = { id: item.id, message: 'Could not reach the clipboard.' };
			}
		}
		busy = '';
	}

	const badge: Record<string, string> = {
		'review-requested': 'review',
		draft: 'draft',
		'in-progress': 'in progress'
	};
</script>

{#if feed.status.state === 'ok'}
	{#if feed.items.length}
		<ul data-testid="{feed.provider}-items">
			{#each feed.items as item (item.id)}
				<li>
					<a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
					<span class="meta">
						<span class="ref">{item.context}{item.context ? ' ' : ''}{item.ref}</span>
						<span class="state">{item.state}</span>
						{#each item.flags as flag (flag)}<span class="flag" class:review={flag === 'review-requested'}>{badge[flag] ?? flag}</span>{/each}
					</span>
					<button class="btn card" onclick={() => makeCard(item)} disabled={busy === item.id} data-testid="make-card">
						{data.slug ? 'Make card' : 'Card line'}
					</button>
					{#if said.id === item.id}<span class="said">{said.message}</span>{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<EmptyState icon="check" title="Nothing open and assigned to you in {feed.scope}." />
	{/if}
{:else}
	<EmptyState
		testid="{feed.provider}-not-connected"
		icon="external-link"
		title={feed.status.message}
		hint="Set {feed.env.length === 1 ? 'this' : 'these'} in prosoche's environment and restart it."
	>
		{#snippet children()}
			<dl>
				{#each feed.env as setting (setting.name)}
					<dt>{setting.name}{#if !setting.required}<span class="opt">optional</span>{/if}</dt>
					<dd>{setting.note}</dd>
				{/each}
			</dl>
		{/snippet}
	</EmptyState>
{/if}

<style>
	ul { list-style: none; margin: 0; padding: 0; }
	li {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 2px 8px;
		padding: 8px 2px;
		border-top: 1px solid var(--line);
		min-width: 0;
	}
	li:first-child { border-top: 0; }
	a { text-decoration: none; min-width: 0; overflow-wrap: anywhere; }
	a:hover { text-decoration: underline; }
	.meta { grid-column: 1; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11px; color: var(--muted); }
	.ref { font-family: var(--mono); }
	.state { background: var(--soft); border-radius: 999px; padding: 1px 7px; }
	.flag { background: var(--soft); border-radius: 999px; padding: 1px 7px; }
	.flag.review { background: #fef3c7; color: var(--warn); }
	.card { grid-row: 1 / 3; grid-column: 2; align-self: center; font-size: 12px; padding: 4px 8px; }
	.said { grid-column: 1 / -1; font-size: 11px; color: var(--muted); }
	dl { margin: 6px 0 0; text-align: left; }
	dt { font: 12px var(--mono); margin-top: 8px; }
	dd { margin: 2px 0 0; color: var(--muted); font-size: 12px; }
	.opt { margin-left: 6px; font-family: inherit; font-size: 11px; color: var(--muted); }

	@media (max-width: 720px) {
		li { grid-template-columns: 1fr; }
		.card { grid-row: auto; grid-column: 1; justify-self: start; }
	}
</style>
