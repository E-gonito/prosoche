<script lang="ts">
	/**
	 * Today's timesheet section, exactly as the note has it.
	 *
	 * Nothing here is editable and nothing posts anywhere: the note is a
	 * document shared at work, so the card says so at the top and every route
	 * out of it leads to Obsidian or to the read-only note view. The numbers
	 * are the note's own, not a re-count, because they are what gets quoted.
	 */
	import Draft from '$lib/components/Draft.svelte';
	import { displayText } from '$lib/shared/task';
	import type { LoadedWidget } from '$lib/shared/widgets';

	/** Produced by `src/lib/server/widgets/timesheet.ts`. */
	interface TimesheetItem {
		number: number;
		text: string;
		children: TimesheetItem[];
	}
	interface TimesheetData {
		date: string;
		path: string | null;
		day: {
			heading: string;
			clock: Array<{ label: string; value: string }>;
			sections: Array<{
				heading: string;
				level: number;
				items: TimesheetItem[];
				blocks: Array<{ fenced: boolean; text: string }>;
			}>;
			blockers: string | null;
		} | null;
		previous: { date: string; heading: string; path: string } | null;
		notes: Array<{ path: string; title: string; days: number; latest: string | null }>;
		folder: string;
	}

	let { widget }: { widget: LoadedWidget; refresh?: () => void } = $props();
	const data = $derived(widget.data as TimesheetData);
	const href = (path: string) => `/notes/${path.split('/').map(encodeURIComponent).join('/')}`;
	const clockLabel: Record<string, string> = { start: 'Start', break: 'Break', leave: 'Leave' };
</script>

<div data-testid="timesheet-widget">
	<p class="banner" data-testid="timesheet-readonly">
		Read only — edited in Obsidian.
		{#if data.path}<a href={href(data.path)}>Open {data.notes.find((n) => n.path === data.path)?.title ?? 'the note'}</a>{/if}
	</p>

	<!--
		The one thing this card offers besides reading: a draft of today's entry,
		built from the time log and the daily note, to copy across by hand. The
		app never writes the timesheet, which is why this produces text and a
		scratch note rather than an edit to the document itself.
	-->
	<div class="draft-row">
		<Draft
			compact
			label="Draft today's entry"
			title="Build a draft from your time log, to paste in yourself"
			request={{ feature: 'timesheet', day: data.date }}
		/>
	</div>

	{#if data.day}
		<h4>{data.day.heading}</h4>
		{#if data.day.clock.length}
			<p class="clock">
				{#each data.day.clock as entry, i (i)}
					<span class="chip"><b>{clockLabel[entry.label] ?? entry.label}</b>{entry.value || '—'}</span>
				{/each}
			</p>
		{/if}

		{#each data.day.sections as section, s (s)}
			{#if section.heading}<h5 class:sub={section.level > 2}>{section.heading}</h5>{/if}
			{#if section.items.length}
				<ul>
					{#each section.items as item (item.number + item.text)}
						<li><span class="n">{item.number})</span> <span>{displayText(item.text)}</span>
							{#if item.children.length}
								<ul class="kids">
									{#each item.children as kid (kid.number + kid.text)}
										<li><span class="n">{kid.number})</span> <span>{displayText(kid.text)}</span></li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#each section.blocks as block, b (b)}
				<pre class:prose={!block.fenced}>{block.text}</pre>
			{/each}
		{/each}

		{#if data.day.blockers !== null}
			<p class="blockers"><b>Blockers</b> {data.day.blockers || 'none written'}</p>
		{/if}
	{:else if data.notes.length}
		<p class="empty" data-testid="timesheet-empty">
			Nothing written for {data.date} yet.
			{#if data.previous}
				The last entry is {data.previous.heading}.
			{/if}
		</p>
	{:else}
		<p class="empty" data-testid="timesheet-empty">
			No timesheet note under {data.folder}. The hub looks for notes named TIMESHEET…, and reads them; it never writes one.
		</p>
	{/if}
</div>

<style>
	.draft-row { margin: 0 0 10px; }
	.banner {
		margin: 0 0 10px;
		padding: 6px 10px;
		background: var(--soft);
		border-radius: 8px;
		font-size: 12px;
		color: var(--muted);
	}
	.banner a { margin-left: 6px; }
	h4 { margin: 0 0 8px; font: 600 14px/1.3 var(--mono); }
	h5 { margin: 12px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); }
	h5.sub { text-transform: none; letter-spacing: 0; font-size: 12px; }
	.clock { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
	.chip { background: var(--accent-soft); color: var(--accent); border-radius: 999px; padding: 2px 10px; font-size: 12px; }
	.chip b { margin-right: 6px; font-weight: 600; }
	ul { list-style: none; margin: 0; padding: 0; }
	li { display: block; padding: 4px 0; font-size: 13px; }
	.kids { margin-left: 18px; }
	.n { color: var(--muted); font: 12px var(--mono); }
	pre {
		margin: 8px 0;
		padding: 8px 10px;
		background: var(--soft);
		border-radius: 8px;
		font: 12px/1.5 var(--mono);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	pre.prose { background: transparent; padding: 0; font: 13px/1.5 inherit; color: var(--muted); }
	.blockers { margin: 10px 0 0; font-size: 13px; }
	.blockers b { color: var(--warn); margin-right: 6px; }
	.empty { color: var(--muted); font-size: 13px; margin: 0; }

	@media (max-width: 720px) {
		.clock { gap: 4px; }
	}
</style>
