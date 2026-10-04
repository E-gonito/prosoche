<script lang="ts">
	/**
	 * Give a task a time on the day, or change the one it has, by tapping
	 * rather than dragging: the way the timeline is planned on a phone, and an
	 * alternative to dragging everywhere else.
	 *
	 * Opened three ways, all with a start already filled in:
	 *  - for a task without a time (a row's clock button): pick the start and
	 *    the length, then Schedule;
	 *  - for a block already on the timeline (a tap on it): change either, or
	 *    Unschedule it, or go on to the full card;
	 *  - for a time with no task yet (a tap on an empty stretch of the
	 *    timeline): pick the task from `choices`, which are grouped as Today
	 *    lays them out.
	 *
	 * It writes nothing itself. `onsave` and `onunschedule` do the writing and
	 * answer with a problem to show, or null once done, when the sheet closes.
	 * Built on the native `<dialog>`, as `CardDrawer` is; on a phone it rises
	 * from the bottom, where a thumb is.
	 */
	import { untrack } from 'svelte';
	import { formatMinutes } from '$lib/shared/time';
	import { displayText, type Task } from '$lib/shared/task';

	let {
		task = null,
		startMin,
		duration = 30,
		choices = [],
		onsave,
		onunschedule,
		onedit,
		onclose
	}: {
		/** The task to place, or null to choose one from `choices`. */
		task?: Task | null;
		/** The start offered, in minutes since midnight. */
		startMin: number;
		/** The length offered, in minutes. */
		duration?: number;
		/** What can be placed, when `task` is null: each group a heading and its tasks. */
		choices?: Array<{ title: string; tasks: Task[] }>;
		onsave: (task: Task, startMin: number, endMin: number) => Promise<string | null>;
		/** Given, a task that already has a time can have it taken off. */
		onunschedule?: (task: Task) => Promise<string | null>;
		/** Given, the task can be opened in the full card editor. */
		onedit?: (task: Task) => void;
		onclose: () => void;
	} = $props();

	/** The lengths offered as one tap each. Any other comes from the end time. */
	const LENGTHS = [15, 30, 45, 60, 90, 120];

	let chosen = $state<Task | null>(untrack(() => task));
	let start = $state(untrack(() => formatMinutes(startMin)));
	let length = $state(untrack(() => duration));
	let saving = $state(false);
	let problem = $state('');
	let dialog: HTMLDialogElement | undefined = $state();

	const timed = $derived(chosen !== null && chosen === task && task?.startMin != null);
	const startMinutes = $derived(toMinutes(start));
	const endMinutes = $derived(startMinutes === null ? null : Math.min(1440, startMinutes + length));
	const label = (m: number) => `${Math.floor(m / 60) ? `${Math.floor(m / 60)}h` : ''}${m % 60 ? `${m % 60}m` : ''}`;
	const hasChoices = $derived(choices.some((g) => g.tasks.length));

	$effect(() => {
		if (!dialog?.open) dialog?.showModal();
	});

	function toMinutes(value: string): number | null {
		const m = /^(\d{1,2}):(\d{2})$/.exec(value);
		if (!m) return null;
		const minutes = Number(m[1]) * 60 + Number(m[2]);
		return minutes < 1440 ? minutes : null;
	}

	/** An end time typed in sets the length; one before the start is refused by leaving the length as it was. */
	function setEnd(value: string) {
		const end = toMinutes(value);
		if (end !== null && startMinutes !== null && end > startMinutes) length = end - startMinutes;
	}

	async function run(write: () => Promise<string | null>) {
		if (saving) return;
		saving = true;
		problem = '';
		const failed = await write();
		saving = false;
		if (failed) problem = failed;
		else onclose();
	}

	const save = () => {
		if (chosen && startMinutes !== null && endMinutes !== null) void run(() => onsave(chosen!, startMinutes, endMinutes));
	};

	/** A click that lands on the dialog itself came from the backdrop. */
	function maybeBackdrop(event: MouseEvent) {
		if (event.target === dialog) onclose();
	}
</script>

<dialog class="modal schedule" bind:this={dialog} {onclose} onclick={maybeBackdrop} data-testid="schedule-sheet" aria-label={chosen ? `Time for ${displayText(chosen.text)}` : 'Put a task on the timeline'}>
	<div class="inner">
		<header>
			<h2>{timed ? 'Change the time' : chosen ? 'Schedule' : `What goes at ${start}?`}</h2>
			<button class="btn ghost close" onclick={onclose} aria-label="Close" data-testid="schedule-close">✕</button>
		</header>

		{#if chosen}
			<p class="task" data-testid="schedule-task-name">{displayText(chosen.text)}</p>
			{#if !task}<button class="btn ghost small change" onclick={() => (chosen = null)}>Pick another</button>{/if}
		{:else if hasChoices}
			<div class="choices" data-testid="schedule-choices">
				{#each choices.filter((g) => g.tasks.length) as group (group.title)}
					<p class="caps">{group.title}</p>
					{#each group.tasks as option (option.path + ':' + option.line)}
						<button class="choice" onclick={() => (chosen = option)} data-testid="schedule-choice">{displayText(option.text)}</button>
					{/each}
				{/each}
			</div>
		{:else}
			<p class="muted">Nothing is waiting for a time. Add a task to the day first.</p>
		{/if}

		{#if chosen}
			<div class="times">
				<label>
					<span class="caps">Start</span>
					<input class="field" type="time" step="300" bind:value={start} data-testid="schedule-start" />
				</label>
				<label>
					<span class="caps">End</span>
					<input
						class="field"
						type="time"
						step="300"
						value={endMinutes === null ? '' : formatMinutes(endMinutes % 1440)}
						onchange={(e) => setEnd(e.currentTarget.value)}
						data-testid="schedule-end"
					/>
				</label>
			</div>
			<div class="lengths" role="group" aria-label="Length">
				{#each LENGTHS as minutes (minutes)}
					<button class="chip-btn" aria-pressed={length === minutes} onclick={() => (length = minutes)} data-testid="schedule-length">{label(minutes)}</button>
				{/each}
			</div>

			{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

			<div class="actions">
				<button class="btn primary" disabled={saving || startMinutes === null} onclick={save} data-testid="schedule-save">
					{saving ? 'Saving…' : startMinutes === null || endMinutes === null ? 'Schedule' : `${timed ? 'Move to' : 'Schedule'} ${formatMinutes(startMinutes)}–${formatMinutes(endMinutes % 1440)}`}
				</button>
				{#if timed && onunschedule}
					<button class="btn" disabled={saving} onclick={() => run(() => onunschedule(task!))} data-testid="schedule-unschedule">Unschedule</button>
				{/if}
				{#if onedit}
					<button class="btn ghost" disabled={saving} onclick={() => onedit(chosen!)} data-testid="schedule-edit">Edit card…</button>
				{/if}
			</div>
		{/if}
	</div>
</dialog>

<style>
	.inner { padding: var(--s4) 18px 18px; display: flex; flex-direction: column; gap: var(--s3); }
	header { display: flex; align-items: center; gap: var(--s2); }
	h2 { margin: 0; font: 600 var(--t16) var(--serif); }
	.close { margin-left: auto; min-width: 40px; min-height: 40px; }
	.task { margin: 0; font-size: var(--t15); line-height: 1.4; }
	.change { align-self: flex-start; margin-top: calc(-1 * var(--s2)); }

	.choices { display: flex; flex-direction: column; max-height: 50dvh; overflow-y: auto; overscroll-behavior: contain; }
	.choices .caps { margin: var(--s3) 0 var(--s1); }
	.choices .caps:first-child { margin-top: 0; }
	.choice {
		flex: none; min-height: 44px; padding: var(--s2) var(--s1); border: 0; border-top: 1px solid var(--line);
		background: none; color: var(--text); font: inherit; font-size: var(--t14); text-align: left; cursor: pointer;
	}
	.choice:hover { background: var(--soft); }

	.times { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); }
	.times label { display: flex; flex-direction: column; gap: var(--s1); }
	.times .field { min-height: 44px; font-size: var(--t16); }
	.lengths { display: flex; flex-wrap: wrap; gap: var(--s2); }
	.chip-btn {
		min-width: 52px; min-height: 40px; padding: 0 var(--s3); border: 1px solid var(--line); border-radius: var(--r-pill);
		background: var(--panel); color: var(--text); font: inherit; font-size: var(--t13); cursor: pointer;
	}
	.chip-btn[aria-pressed='true'] { background: var(--accent); border-color: var(--accent); color: #fff; }

	.actions { display: flex; flex-wrap: wrap; gap: var(--s2); }
	.actions .btn { min-height: 44px; }
	.actions .primary { flex: 1 1 100%; }

	/* On a phone, a sheet from the bottom of the screen, where the thumb is. */
	@media (max-width: 720px) {
		.schedule {
			width: 100%;
			max-width: none;
			margin: auto 0 0;
			border-radius: var(--r-lg) var(--r-lg) 0 0;
			max-height: 90dvh;
			padding-bottom: env(safe-area-inset-bottom);
		}
	}
</style>
