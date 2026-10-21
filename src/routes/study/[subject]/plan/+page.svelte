<script lang="ts">
	/**
	 * A subject's Overview: one goal at a time, as the steps it takes.
	 *
	 * The goal is the subject's focus (`focusOn`): the one `focus:` in
	 * `Goals.md` names, or else the first unfinished one. Above it the goals
	 * sit in a row, in priority order, and picking one makes it the focus; one
	 * whose next step is due within a week shows that date, so a deadline
	 * on a goal not in focus is not missed.
	 * The card says where the goal stands, then the one step to do now, with
	 * Done beside it and what to read for it, then every step in order.
	 * Ticking a step is the ordinary task rewrite. Below it all, the
	 * subject's principles, `Principles.md`, read rendered and edited raw.
	 *
	 * Starting is made as small as it can be: the step's estimate, first move
	 * and parts (its `est::`, `first::` and `part::` sub-bullets) show on the
	 * Now card; Plan with Claude drafts them as a proposal to accept; Tutor
	 * prompt gives a prompt to paste into Claude Code in the step's repo, for a
	 * Socratic tutor that hints rather than answers. A goal with late steps
	 * offers to move them back onto the calendar, keeping their gaps.
	 */
	import { invalidateAll } from '$app/navigation';
	import StudyTabs from '$lib/components/StudyTabs.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import StepText from '$lib/components/StepText.svelte';
	import MasterNote from '$lib/components/MasterNote.svelte';
	import Draft from '$lib/components/Draft.svelte';
	import { tutorCommand, tutorPrompt } from '$lib/shared/tutor';
	import { api, editTask } from '$lib/client/api';
	import { dueLabel } from '$lib/shared/kanban';
	import { daysBetween } from '$lib/shared/time';
	import type { FocusStep } from '$lib/shared/study';
	import type { Task } from '$lib/shared/task';

	let { data } = $props();

	const base = $derived(`/study/${data.subject.slug}`);
	const focus = $derived(data.study.focus);
	const goals = $derived(data.study.progress);
	const now = $derived(focus?.steps.find((s) => s.state === 'now') ?? null);
	/** Its number among the steps that count, so a skipped one does not take a number. */
	const counted = $derived(focus ? focus.steps.filter((s) => s.state !== 'skipped') : []);
	const numberOf = (step: FocusStep) => counted.indexOf(step) + 1;
	const nextGoal = $derived(focus ? (goals.find((g, i) => i !== focus.index && g.done < g.total) ?? null) : null);
	/** Within this many days, a goal's next step shows its date on the goal's button. */
	const SOON = 7;
	const soon = (due: string | null | undefined) => (due ? daysBetween(data.today, due) <= SOON : false);
	const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

	/** "in 9 days", "due today", "3 days late". */
	function when(days: number): string {
		if (days === 0) return 'due today';
		if (days === 1) return 'due tomorrow';
		if (days > 1) return `in ${days} days`;
		return days === -1 ? '1 day late' : `${-days} days late`;
	}

	let busy = $state(false);
	let problem = $state('');

	async function choose(name: string) {
		if (busy || name === focus?.name) return;
		busy = true;
		problem = '';
		const result = await api('/api/study/goal', { subject: data.subject.slug, focus: name }, { method: 'PATCH' });
		busy = false;
		if (result.ok) await invalidateAll();
		else problem = result.message;
	}

	/** The open steps whose date has passed, and how far the earliest is behind. */
	const late = $derived.by(() => {
		const open = focus?.steps.filter((s) => (s.state === 'now' || s.state === 'later') && s.daysLeft !== null && s.daysLeft < 0) ?? [];
		return { count: open.length, by: open.length ? -Math.min(...open.map((s) => s.daysLeft!)) : 0 };
	});

	async function replan() {
		if (busy || !focus) return;
		busy = true;
		problem = '';
		const result = await api('/api/study/replan', { subject: data.subject.slug, goal: focus.name });
		busy = false;
		if (result.ok) await invalidateAll();
		else problem = result.message;
	}

	let tutoring = $state(false);
	let copied = $state('');
	const prompt = $derived(
		focus && now
			? tutorPrompt({
					subject: data.subject.name,
					goal: focus.name,
					step: now.task.text,
					due: now.task.due,
					details: now.details,
					repo: focus.repo,
					reading: focus.resources.map((r) => (r.url ? `${r.title} (${r.url})` : r.title))
				})
			: ''
	);
	const command = $derived(tutorCommand(focus?.repo ?? null));

	/**
	 * Copy `text`. The page is served over plain http on the tailnet, where
	 * the async clipboard API is not offered, so a hidden selection and the
	 * older copy command stand in for it.
	 */
	async function copy(text: string, what: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			const area = document.createElement('textarea');
			area.value = text;
			area.style.position = 'fixed';
			area.style.opacity = '0';
			document.body.appendChild(area);
			area.select();
			document.execCommand('copy');
			area.remove();
		}
		copied = what;
		setTimeout(() => (copied = ''), 2000);
	}

	async function tick(task: Task, done: boolean) {
		if (busy) return;
		busy = true;
		problem = '';
		const result = await editTask(task, { status: done ? 'done' : 'todo' });
		busy = false;
		if (result.ok) await invalidateAll();
		else problem = result.message;
	}
</script>

{#snippet words(text: string)}
	<StepText {text} />
{/snippet}

<svelte:head><title>Plan · {data.subject.name} · Study · prosoche</title></svelte:head>

<div class="page">
	<StudyTabs subject={data.subject} lede="One goal at a time, one step at a time." />

	{#if !focus}
		<p class="empty">
			No goals yet. <a href="{base}/goals">Add the first one</a>, with the steps it takes, and this page will walk you through
			them one at a time.
		</p>
	{:else}
		{#if goals.length > 1}
			<nav class="switch" aria-label="Goals" data-testid="goal-switch">
				{#each goals as goal, i (goal.slug)}
					<button
						type="button"
						class="pill"
						class:finished={goal.total > 0 && goal.done === goal.total}
						aria-current={i === focus.index ? 'true' : undefined}
						disabled={busy}
						onclick={() => choose(goal.name)}
						data-testid="goal-pill"
					>
						<span class="n num">{i + 1}</span>
						<span class="name">{goal.name}</span>
						<span class="num muted">{goal.done}/{goal.total}</span>
						{#if i !== focus.index && goal.next?.due && soon(goal.next.due)}
							<span class="soon num" class:late={daysBetween(data.today, goal.next.due) < 0} data-testid="goal-due">{dueLabel(goal.next.due, data.today)}</span>
						{/if}
					</button>
				{/each}
			</nav>
		{/if}

		{#if problem}<p class="problem" role="status">{problem}</p>{/if}

		<section class="sheet focus" data-testid="focus">
			<p class="caps">
				Goal {focus.index + 1} of {goals.length}
				{#if focus.target}
					<span class="right num" class:late={focus.daysLeft !== null && focus.daysLeft < 0}>
						Target {dueLabel(focus.target, data.today)}{focus.daysLeft !== null ? ` · ${when(focus.daysLeft).replace('due ', '')}` : ''}
					</span>
				{/if}
			</p>
			<h2>{focus.name}</h2>
			<div class="bar" aria-hidden="true"><i style="width: {pct(focus.done, focus.total)}%"></i></div>
			<p class="facts small muted">
				<span class="num" data-testid="focus-progress">{focus.done} of {focus.total} steps done</span>
			</p>
			{#if late.count}
				<div class="behind" data-testid="behind">
					<span>
						{late.count} {late.count === 1 ? 'step is' : 'steps are'} late. Replanning moves this goal's open steps {late.by}
						{late.by === 1 ? 'day' : 'days'} later, keeping the gaps between them.
					</span>
					<button class="btn small" disabled={busy} onclick={replan} data-testid="replan">Replan from today</button>
				</div>
			{/if}

			{#if now}
				<div class="now" data-testid="step-now">
					<p class="caps">
						Now · step {numberOf(now)} of {focus.total}
						{#if now.task.due && now.daysLeft !== null}
							<span class="right num" class:late={now.daysLeft < 0}>{dueLabel(now.task.due, data.today)} · {when(now.daysLeft)}</span>
						{/if}
					</p>
					<p class="task">{@render words(now.task.text)}</p>
					{#if now.details.est || now.details.first}
						<p class="start" data-testid="step-start">
							{#if now.details.est}<span class="est num" data-testid="step-est"><Icon name="clock" size={14} /> about {now.details.est}</span>{/if}
							{#if now.details.first}<span class="first" data-testid="step-first"><b>First:</b> {@render words(now.details.first)}</span>{/if}
						</p>
					{/if}
					{#if now.details.parts.length}
						<ol class="parts" data-testid="step-parts">
							{#each now.details.parts as part, i (i)}<li>{@render words(part)}</li>{/each}
						</ol>
					{/if}
					<div class="actions">
						<button class="btn primary" disabled={busy} onclick={() => tick(now.task, true)} data-testid="step-done">
							<Icon name="check" size={15} /> Done
						</button>
						<button class="btn" aria-expanded={tutoring} onclick={() => (tutoring = !tutoring)} data-testid="tutor-open">Tutor prompt</button>
					</div>
					<div class="plan">
						<Draft
							label={now.details.parts.length ? 'Plan again with Claude' : 'Plan with Claude'}
							title="Claude drafts an estimate, a first move and short parts for this step. Nothing is written until you accept."
							endpoint="/api/study/plan"
							request={{ subject: data.subject.slug, line: now.task.line }}
							ondone={() => invalidateAll()}
						/>
					</div>
					{#if tutoring}
						<div class="tutor" data-testid="tutor">
							<p class="small">
								Paste this into Claude Code{focus.repo ? ' in the repo' : ''}. It will hint and ask rather than answer, and handle the setup for you.
							</p>
							{#if command}
								<div class="cmd">
									<code data-testid="tutor-command">{command}</code>
									<button class="btn small" onclick={() => copy(command, 'command')}>{copied === 'command' ? 'Copied' : 'Copy'}</button>
								</div>
							{:else}
								<p class="small muted">Add a <code>repo::</code> line under this goal's heading in Goals.md, such as <code>repo:: ~/dev/leyline-front</code>, and the prompt will point Claude at it.</p>
							{/if}
							<textarea class="field" readonly rows="10" value={prompt} onfocus={(e) => e.currentTarget.select()} data-testid="tutor-prompt"></textarea>
							<button class="btn primary small" onclick={() => copy(prompt, 'prompt')} data-testid="tutor-copy">{copied === 'prompt' ? 'Copied' : 'Copy prompt'}</button>
						</div>
					{/if}
				</div>
			{:else if focus.total > 0}
				<div class="now finished" data-testid="goal-finished">
					<p><b>Every step of this goal is done.</b></p>
					{#if nextGoal}
						<button class="btn primary" disabled={busy} onclick={() => choose(nextGoal.name)} data-testid="next-goal">
							Next goal: {nextGoal.name}
						</button>
					{/if}
				</div>
			{:else}
				<p class="empty">This goal has no steps yet. <a href="{base}/goals">Add them on Goals</a>.</p>
			{/if}

			{#if focus.resources.length}
				<p class="caps sub">For this goal</p>
				<ul class="resources" data-testid="focus-resources">
					{#each focus.resources as item (item.line)}
						<li>
							<Icon name="book-open" size={14} />
							{#if item.url}<a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>{:else}<span>{item.title}</span>{/if}
							{#if item.group === 'Reading'}<span class="badge">Reading</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if focus.steps.length}
				<p class="caps sub">All steps</p>
				<ol class="steps" data-testid="steps">
					{#each focus.steps as step (step.task.line)}
						<li class="is-{step.state}" data-testid="step">
							<label>
								<input
									type="checkbox"
									checked={step.state === 'done'}
									disabled={busy || step.state === 'skipped'}
									onchange={(e) => tick(step.task, e.currentTarget.checked)}
									aria-label={step.state === 'done' ? 'Not done yet' : 'Done'}
								/>
								<span class="n num">{step.state === 'skipped' ? '–' : numberOf(step)}</span>
								<span class="text">{@render words(step.task.text)}</span>
							</label>
							{#if step.details.est && step.state !== 'done' && step.state !== 'skipped'}
								<span class="step-est num small">{step.details.est}</span>
							{/if}
							{#if step.task.due && step.state !== 'done' && step.state !== 'skipped'}
								<span class="due num small" class:late={step.daysLeft !== null && step.daysLeft < 0}>{dueLabel(step.task.due, data.today)}</span>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</section>

		<p class="more small muted">
			<a href="{base}/goals">Edit goals and steps</a> · <a href="{base}/reading">Reading list</a>
		</p>
	{/if}

	<section class="principles" data-testid="principles">
		<p class="caps sub">Principles</p>
		<MasterNote
			{...data.principles}
			empty="No principles yet: the rules you want to study this subject by."
			action="Write principles"
		/>
	</section>
</div>

<style>
	/* The goals, in priority order: a row that scrolls sideways on a phone. */
	.switch { display: flex; gap: var(--s2); overflow-x: auto; padding-bottom: var(--s2); margin-bottom: var(--s3); scrollbar-width: thin; }
	.pill {
		flex: none; display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 4px var(--s3);
		border: 1px solid var(--line); border-radius: var(--r-pill); background: var(--panel); color: var(--text);
		font: inherit; font-size: var(--t13); cursor: pointer;
	}
	.pill:hover:not(:disabled) { border-color: var(--accent); }
	.pill[aria-current='true'] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
	.pill[aria-current='true'] .muted, .pill[aria-current='true'] .n { color: var(--on-accent); opacity: 0.85; }
	.pill .n { color: var(--muted); font-weight: 600; }
	.pill.finished .name { text-decoration: line-through; }
	.pill .soon { font-size: var(--t11); font-weight: 600; padding: 1px 6px; border-radius: var(--r-pill); background: var(--soft); color: var(--text); }
	.pill .soon.late { background: var(--bad); color: #fff; }

	.focus h2 { margin: var(--s1) 0 0; font: 600 var(--t24)/1.2 var(--serif); }
	.caps { display: flex; align-items: baseline; gap: var(--s2); margin: 0; }
	.caps .right { margin-left: auto; font-weight: 500; text-transform: none; letter-spacing: 0; }
	.late { color: var(--bad); }
	.bar { height: 6px; border-radius: var(--r-pill); background: var(--soft); overflow: hidden; margin-top: var(--s3); }
	.bar i { display: block; height: 100%; background: var(--accent); }
	.facts { display: flex; flex-wrap: wrap; gap: var(--s1) var(--s4); margin: var(--s2) 0 0; }

	/* The one step to do now: the page's centre of gravity. */
	.now { margin-top: var(--s4); padding: var(--s4); border-radius: var(--r-md); background: var(--accent-soft); }
	.now.finished { background: var(--soft); }
	.now.finished p { margin: 0 0 var(--s3); }
	.now .task { margin: var(--s2) 0 var(--s3); font-size: var(--t16); line-height: 1.45; }
	.actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); }
	.actions .btn { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; }
	code { font: 0.92em var(--mono); background: var(--soft); padding: 0 4px; border-radius: var(--r-sm); }
	.now code { background: var(--panel); }

	.sub { margin-top: var(--s5); margin-bottom: var(--s2); }
	.resources { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: var(--t14); }
	.resources li { display: flex; align-items: center; gap: var(--s2); }
	.resources :global(svg) { color: var(--muted); flex: none; }
	.badge { font-size: var(--t11); padding: 1px 6px; border-radius: var(--r-pill); background: var(--soft); color: var(--muted); }

	.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
	.steps li { display: flex; align-items: flex-start; gap: var(--s2); padding: var(--s2) 0; border-top: 1px solid var(--line); font-size: var(--t14); }
	.steps li:first-child { border-top: 0; }
	.steps label { display: flex; align-items: flex-start; gap: var(--s2); flex: 1; cursor: pointer; line-height: 1.4; }
	.steps input { flex: none; margin-top: 3px; }
	.steps .n { flex: none; width: 1.5em; color: var(--muted); text-align: right; }
	.steps .due { flex: none; margin-left: auto; color: var(--muted); white-space: nowrap; padding-top: 1px; }
	.steps .due.late { color: var(--bad); }
	.steps .is-done .text { color: var(--muted); text-decoration: line-through; }
	.steps .is-skipped .text { color: var(--muted); text-decoration: line-through; font-style: italic; }
	.steps .is-now { font-weight: 600; }

	.more { margin-top: var(--s4); }

	.start { display: flex; flex-wrap: wrap; gap: var(--s1) var(--s4); margin: 0 0 var(--s3); font-size: var(--t14); }
	.est { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; }
	.first b { font-weight: 600; }
	.parts { margin: 0 0 var(--s3); padding-left: 1.4em; font-size: var(--t14); line-height: 1.5; }
	.plan { margin-top: var(--s2); }
	.tutor { margin-top: var(--s3); padding-top: var(--s3); border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: var(--s2); align-items: flex-start; }
	.tutor p { margin: 0; }
	.tutor textarea { width: 100%; font: var(--t12)/1.5 var(--mono); }
	.cmd { display: flex; align-items: center; gap: var(--s2); }
	.behind { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2) var(--s3); margin-top: var(--s3); padding: var(--s2) var(--s3); border-radius: var(--r-md); background: var(--bad-soft); color: var(--bad); font-size: var(--t13); }
	.behind span { flex: 1; min-width: 200px; }
	.steps .step-est { flex: none; color: var(--muted); white-space: nowrap; padding-top: 1px; margin-left: auto; }
	.steps .step-est + .due { margin-left: var(--s2); }
	.principles { margin-top: var(--s5); }
</style>
