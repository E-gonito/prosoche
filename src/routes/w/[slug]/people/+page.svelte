<script lang="ts">
	/**
	 * A workspace's CRM: who it knows, and the deals in flight.
	 *
	 * The pipeline groups deals by stage; moving one writes through
	 * `/api/deal`, the same per-line conflict guard `/api/task` uses, so a
	 * stage picked from a stale page never clobbers a change made elsewhere.
	 */
	import { invalidateAll } from '$app/navigation';

	/** The shape `listDeals` sends over the wire; kept local since this page is its only client. */
	interface Deal {
		line: number;
		raw: string;
		text: string;
		person: string | null;
		stage: string | null;
		value: number | null;
		next: string | null;
	}

	let { data } = $props();

	let addingDeal = $state(false);
	let dealName = $state('');
	let dealPerson = $state('');
	let dealValue = $state('');
	let dealNext = $state('');
	let problem = $state('');
	let busy = $state('');

	const byStage = $derived.by(() => {
		const groups = new Map<string, Deal[]>(data.stages.map((s: string) => [s, []]));
		for (const deal of data.deals) {
			const stage = deal.stage && groups.has(deal.stage) ? deal.stage : (data.stages[0] ?? 'lead');
			groups.get(stage)?.push(deal);
		}
		return groups;
	});

	async function setStage(deal: Deal, stage: string) {
		const key = `${deal.line}`;
		if (busy === key) return;
		busy = key;
		const res = await fetch('/api/deal', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ workspace: data.workspace.slug, line: deal.line, expectedRaw: deal.raw, stage })
		});
		busy = '';
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			problem = body.error ?? 'That changed on another device. Reloading.';
			await invalidateAll();
			return;
		}
		await invalidateAll();
	}

	async function addDeal(event: Event) {
		event.preventDefault();
		if (!dealName.trim()) return;
		const res = await fetch('/api/deal', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				workspace: data.workspace.slug,
				text: dealName,
				person: dealPerson || null,
				value: dealValue || null,
				next: dealNext || null
			})
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			problem = body.error ?? 'Could not add that deal.';
			return;
		}
		problem = '';
		dealName = '';
		dealPerson = '';
		dealValue = '';
		dealNext = '';
		addingDeal = false;
		await invalidateAll();
	}

	const personHref = (name: string) => `/people/${encodeURIComponent(name)}`;
</script>

<p class="label">People <span class="right">{data.people.length}</span></p>
<div class="sheet rows">
	{#each data.people as person (person.name)}
		<a class="row" href={person.href}>
			<span>
				<b>{person.name}</b>
				{#if person.role || person.org}<span class="muted small"> · {[person.role, person.org].filter(Boolean).join(' · ')}</span>{/if}
			</span>
			<span class="muted small">
				{#if person.openFollowUps}{person.openFollowUps} open{/if}
				{#if person.lastContact}· last {person.lastContact}{/if}
			</span>
		</a>
	{:else}
		<p class="none">Nobody mentioned in this workspace's notes yet.</p>
	{/each}
</div>

<p class="label">
	Deals <span class="right">{data.deals.length}</span>
</p>
{#if problem}<p class="problem">{problem}</p>{/if}

<div class="pipeline">
	{#each data.stages as stage (stage)}
		<section class="stage" data-testid="deal-stage">
			<h4>{stage} <span class="n">{(byStage.get(stage) ?? []).length}</span></h4>
			<div class="cards">
				{#each byStage.get(stage) ?? [] as deal (deal.line)}
					<article class="deal" data-testid="deal-card">
						<p class="name">{deal.text.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, t, a) => a || t)}</p>
						{#if deal.person}<a class="person" href={personHref(deal.person)}>{deal.person}</a>{/if}
						<div class="meta">
							{#if deal.value !== null}<span>£{deal.value.toLocaleString()}</span>{/if}
							{#if deal.next}<span>next {deal.next}</span>{/if}
						</div>
						<select
							class="field small"
							aria-label="Stage for {deal.text}"
							data-testid="deal-stage-select"
							value={deal.stage ?? data.stages[0]}
							disabled={busy === `${deal.line}`}
							onchange={(e) => setStage(deal, e.currentTarget.value)}
						>
							{#each data.stages as option (option)}<option value={option}>{option}</option>{/each}
						</select>
					</article>
				{/each}
			</div>
		</section>
	{/each}
</div>

{#if addingDeal}
	<form class="add-deal" onsubmit={addDeal}>
		<input bind:value={dealName} placeholder="Deal name" aria-label="Deal name" data-testid="deal-name" />
		<input bind:value={dealPerson} placeholder="Person (optional)" aria-label="Person" data-testid="deal-person" />
		<input bind:value={dealValue} placeholder="Value (optional)" aria-label="Value" data-testid="deal-value" />
		<input bind:value={dealNext} type="date" aria-label="Next date" data-testid="deal-next" />
		<button class="btn primary" data-testid="deal-add" disabled={!dealName.trim()}>Add deal</button>
		<button type="button" class="btn ghost" onclick={() => (addingDeal = false)}>Cancel</button>
	</form>
{:else}
	<button class="btn" data-testid="add-deal-open" onclick={() => (addingDeal = true)}>Add deal</button>
{/if}

<style>
	.row { display: flex; justify-content: space-between; gap: var(--s3); padding: var(--s2); border-top: 1px solid var(--line); color: var(--text); }
	.row:first-child { border-top: 0; }
	.row:hover { text-decoration: none; background: var(--soft); }
	.problem { font-size: var(--t12); color: var(--bad); }

	.pipeline { display: flex; gap: var(--s3); overflow-x: auto; padding-bottom: var(--s2); margin-bottom: var(--s3); }
	.stage { flex: 1 1 200px; min-width: 200px; background: var(--soft); border: 1px solid var(--line); border-radius: var(--r); padding: var(--s2); }
	.stage h4 { display: flex; margin: 2px 2px var(--s2); font-size: var(--t12); text-transform: capitalize; color: var(--muted); }
	.stage h4 .n { margin-left: auto; }
	.cards { display: flex; flex-direction: column; gap: var(--s2); }
	.deal { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--s2); font-size: var(--t13); }
	.deal .name { margin: 0 0 2px; font-weight: 500; }
	.deal .person { display: inline-block; font-size: var(--t12); margin-bottom: 2px; }
	.deal .meta { display: flex; gap: var(--s2); font-size: var(--t11); color: var(--muted); margin-bottom: var(--s1); }
	.deal select { width: 100%; }

	.add-deal { display: flex; flex-wrap: wrap; gap: var(--s2); align-items: center; }
	.add-deal input { border: 1px solid var(--line); border-radius: var(--r-md); padding: 6px 10px; font: inherit; background: var(--field); }

	@media (max-width: 720px) {
		.pipeline { flex-direction: column; }
		.stage { min-width: 0; }
	}
</style>
