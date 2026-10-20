<script lang="ts">
	/**
	 * A mission: the drills one at a time against a visible clock, a short
	 * verdict after each, then the debrief, and the whole mission appended
	 * to the attempt log in one write.
	 *
	 * Each drill is read first, untimed: the situation, and the map unless
	 * the map is the question (a clear-order drill). Space shows the options
	 * and starts the clock, so the time measured is deciding, not reading,
	 * as in game, where you already see the room. An answer within the limit is in time; within `overtime`
	 * limits it is late; past that the drill times out on its own. The Why
	 * is never on screen until the mission is over. On a miss the debrief
	 * asks what you think went wrong before it shows it, and answering is
	 * optional.
	 *
	 * Keys are caught before the app's own shortcuts while a drill is on, so
	 * C picks option C rather than opening capture.
	 */
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/client/api';
	import TacticMap from '$lib/components/tactics/TacticMap.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import {
		judge,
		missionGrade,
		optionIndexForKey,
		tagAccuracy,
		TACTICS,
		type Judged,
		type Result,
		type ScenarioView
	} from '$lib/shared/tactics';

	let { data } = $props();

	interface Played {
		scenario: ScenarioView;
		answer: string[] | null;
		ms: number;
		at: string;
		judged: Judged;
	}

	/** `brief` is a drill being read, before its clock; `drill` is the clock running. */
	type Phase = 'ready' | 'brief' | 'drill' | 'feedback' | 'debrief';

	let phase = $state<Phase>('ready');
	let at = $state(0);
	let picked = $state<string[]>([]);
	let startedAt = 0;
	let elapsed = $state(0);
	let played = $state<Played[]>([]);
	let mission = '';
	let saved = $state<'no' | 'saving' | 'yes'>('no');
	let saveProblem = $state('');
	let guesses = $state<Record<number, string>>({});
	let revealed = $state<Record<number, boolean>>({});

	// A new page load is a new mission.
	$effect(() => {
		void data.drills;
		phase = 'ready';
		at = 0;
		picked = [];
		played = [];
		saved = 'no';
		saveProblem = '';
		guesses = {};
		revealed = {};
	});

	const drill = $derived(data.drills[at] ?? null);
	const limitMs = $derived((drill?.timeLimitS ?? 1) * 1000);
	const late = $derived(elapsed > limitMs);
	const last = $derived(played[played.length - 1] ?? null);

	// The clock: one frame at a time while a drill is on, timing out on its own.
	$effect(() => {
		if (phase !== 'drill') return;
		let frame = 0;
		const tick = () => {
			elapsed = performance.now() - startedAt;
			if (elapsed > limitMs * TACTICS.overtime) return submit(null);
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	});

	// The verdict sits under the options, below the fold on a short screen.
	let verdict = $state<HTMLElement | null>(null);
	$effect(() => verdict?.scrollIntoView({ block: 'nearest' }));

	function begin() {
		mission = `m-${stamp().replace(/[-:]/g, '').replace('T', '-')}`;
		show(0);
	}

	function show(index: number) {
		at = index;
		picked = [];
		elapsed = 0;
		phase = 'brief';
	}

	function go() {
		if (phase !== 'brief') return;
		startedAt = performance.now();
		phase = 'drill';
	}

	function submit(answer: string[] | null) {
		if (phase !== 'drill' || !drill) return;
		const ms = performance.now() - startedAt;
		played = [...played, { scenario: drill, answer, ms, at: stamp(), judged: judge(drill, answer, ms) }];
		phase = 'feedback';
	}

	function pick(id: string) {
		if (phase !== 'drill' || !drill || picked.includes(id)) return;
		picked = [...picked, id];
		if (picked.length === (drill.answers[0]?.length ?? drill.map?.angles.length ?? 0)) submit(picked);
	}

	function next() {
		if (phase !== 'feedback') return;
		if (at + 1 < data.drills.length) show(at + 1);
		else void finish();
	}

	async function finish() {
		phase = 'debrief';
		await save();
	}

	async function save() {
		saved = 'saving';
		saveProblem = '';
		const device = matchMedia('(pointer: coarse)').matches ? 'phone' : 'pc';
		const result = await api('/api/tactics/mission', {
			mission,
			device,
			drills: played.map((p) => ({ scenario: p.scenario.id, answer: p.answer, ms: p.ms, at: p.at }))
		});
		saved = result.ok ? 'yes' : 'no';
		if (!result.ok) saveProblem = result.message;
	}

	function key(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (phase === 'debrief') return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select')) return;
		const claimed = event.key.length === 1 || event.key === 'Backspace' || event.key === 'Enter';
		if (claimed) event.preventDefault();

		if (phase === 'ready' && (event.key === ' ' || event.key === 'Enter')) begin();
		else if (phase === 'brief' && (event.key === ' ' || event.key === 'Enter')) go();
		else if (phase === 'feedback' && (event.key === ' ' || event.key === 'Enter')) next();
		else if (phase === 'drill' && drill) {
			if (drill.drill === 'clear-order') {
				if (event.key === 'Backspace') picked = picked.slice(0, -1);
				const index = optionIndexForKey(event.key, false);
				const angle = index === null ? null : drill.map?.angles[index];
				if (angle) pick(angle.id);
			} else {
				const index = optionIndexForKey(event.key, true);
				const option = index === null ? null : drill.options[index];
				if (option) submit([option.key]);
			}
		}
	}

	/** Local time, as the log writes it. */
	function stamp(d = new Date()): string {
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
	}

	const VERDICT: Record<Result, string> = { 'in-time': 'In time', late: 'Right, but late', wrong: 'Wrong', timeout: 'Out of time' };
	const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
	const pct = (n: number) => `${Math.round(n * 100)}%`;

	function answerText(s: ScenarioView, answer: string[] | null): string {
		if (!answer) return 'no answer';
		if (s.drill === 'clear-order') return answer.join(' → ');
		const option = s.options.find((o) => o.key === answer[0]);
		return option ? `${option.key}: ${option.text}` : answer[0];
	}

	// The debrief.
	const graded = $derived(missionGrade(played.map((p) => p.judged)));
	const misses = $derived(played.map((p, i) => ({ ...p, i })).filter((p) => !p.judged.correct || p.judged.roe));
	const tagChange = $derived.by(() => {
		const scenarios = new Map(played.map((p) => [p.scenario.id, p.scenario]));
		const after = tagAccuracy(played.map((p) => ({ scenario: p.scenario.id, correct: p.judged.correct })), scenarios, data.tags);
		const touched = [...new Set(played.flatMap((p) => p.scenario.tags))];
		return touched
			.map((tag) => ({ tag, before: data.tags[tag]?.accuracy ?? TACTICS.prior, after: after[tag].accuracy }))
			.sort((a, b) => a.after - b.after);
	});
	const median = $derived.by(() => {
		const sorted = played.map((p) => p.ms).sort((a, b) => a - b);
		return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
	});
</script>

<svelte:head><title>Mission · Tactics · prosoche</title></svelte:head>
<svelte:window onkeydowncapture={key} />

<div class="page mission">
	<div class="title">
		<a class="crumb" href="/tactics">Tactics</a>
		<h1>{phase === 'debrief' ? 'Debrief' : 'Mission'}</h1>
		{#if data.drafts}<p class="draft-note">Includes drafts you have not checked yet.</p>{/if}
	</div>

	{#if data.drills.length === 0}
		<div class="empty big" data-testid="mission-empty">
			<h2>Nothing to drill</h2>
			<p class="muted">No scenarios fit this mission. Approve some, or include drafts.</p>
			<a class="btn" href="/tactics">Back to Tactics</a>
		</div>
	{:else if phase === 'ready'}
		<div class="empty big ready" data-testid="mission-ready">
			<h2>{data.drills.length} drills</h2>
			<p class="muted">
				Read each situation first, with no clock. Press Space when you have it, and the options appear with the clock
				running. A right answer after the limit still scores {TACTICS.points.late}, so take the time you need rather than guess.
			</p>
			<button class="btn primary" onclick={begin} data-testid="mission-begin">Begin <kbd>Space</kbd></button>
		</div>
	{:else if (phase === 'brief' || phase === 'drill' || phase === 'feedback') && drill}
		<div class="drill" data-testid="drill" data-drill={drill.drill} data-phase={phase}>
			<p class="meta">
				<span class="num">{at + 1} of {data.drills.length}</span>
				<span>{drill.drill}</span>
				<span class="muted">{drill.tags.join(' ')}</span>
			</p>

			<div class="clock" class:late aria-hidden="true">
				<i style="width: {late ? Math.min(100, ((elapsed - limitMs) / (limitMs * (TACTICS.overtime - 1))) * 100) : 100 - (elapsed / limitMs) * 100}%"></i>
			</div>
			<p class="time num" class:late data-testid="drill-clock">
				{#if phase === 'brief'}{drill.timeLimitS}s once you start{:else if phase === 'feedback'}&nbsp;{:else if late}late +{secs(elapsed - limitMs)}{:else}{secs(limitMs - elapsed)}{/if}
			</p>

			<div class="situation prose" data-testid="drill-situation">{@html drill.situationHtml}</div>

			{#if phase === 'brief'}
				{#if drill.map && drill.drill !== 'clear-order'}<TacticMap map={drill.map} />{/if}
				<div class="start-drill">
					<button class="btn primary" onclick={go} data-testid="show-options">
						{drill.drill === 'clear-order' ? 'Show the map' : 'Show the options'} <kbd>Space</kbd>
					</button>
					<span class="muted small">The clock starts when you press it.</span>
				</div>
			{:else}
			{#if drill.map}
				<TacticMap map={drill.map} picked={phase === 'feedback' ? (last?.answer ?? []) : picked} onpick={drill.drill === 'clear-order' && phase === 'drill' ? pick : undefined} />
			{/if}

			{#if drill.drill === 'clear-order'}
				<div class="order">
					<span class="muted small">Order:</span>
					{#if picked.length}<b class="num">{picked.join(' → ')}</b>{:else}<span class="muted small">pick the angles in the order you clear them (1–{drill.map?.angles.length ?? 0})</span>{/if}
					{#if phase === 'drill'}
						<div class="angle-keys">
							{#each drill.map?.angles ?? [] as a, i (a.id)}
								<button class="btn small" disabled={picked.includes(a.id)} onclick={() => pick(a.id)}><em>{i + 1}</em>{a.id}</button>
							{/each}
							<button class="btn small ghost" disabled={!picked.length} onclick={() => (picked = picked.slice(0, -1))} data-testid="undo-angle">Undo</button>
						</div>
					{/if}
				</div>
			{:else}
				<ol class="options" data-testid="drill-options">
					{#each drill.options as o, i (o.key)}
						{@const chosen = phase === 'feedback' && last?.answer?.[0] === o.key}
						{@const right = phase === 'feedback' && drill.answers.some((a) => a[0] === o.key)}
						<li>
							<button class="option" class:chosen class:right disabled={phase !== 'drill'} onclick={() => submit([o.key])} data-testid="option-{o.key}">
								<em>{i + 1}</em><b>{o.key}</b><span>{o.text}</span>
							</button>
						</li>
					{/each}
				</ol>
			{/if}
			{/if}

			{#if phase === 'feedback' && last}
				<div bind:this={verdict} class="verdict {last.judged.correct ? 'good' : 'bad'}" data-testid="verdict" data-result={last.judged.result}>
					{#if last.judged.roe}<p class="roe" data-testid="roe-violation">ROE violation: this mission is graded D whatever the score.</p>{/if}
					<p>
						<b>{VERDICT[last.judged.result]}</b>
						<span class="num">{secs(last.ms)}</span> · {last.judged.points} points
					</p>
					{#if !last.judged.correct}<p class="small">The answer was <b>{answerText(drill, drill.answers[0])}</b>. The why is in the debrief.</p>{/if}
					<button class="btn primary" onclick={next} data-testid="next-drill">{at + 1 < data.drills.length ? 'Next' : 'Debrief'} <kbd>Space</kbd></button>
				</div>
			{/if}
		</div>
	{:else if phase === 'debrief'}
		<div class="debrief" data-testid="debrief">
			<div class="grade-row">
				<span class="grade g-{graded.grade}" data-testid="mission-grade">{graded.grade}</span>
				<div>
					<p class="num"><b>{Math.round(graded.mean)}</b> mean over {played.length} drills · {played.filter((p) => p.judged.correct).length} right</p>
					<p class="muted small num">Median answer {secs(median)}</p>
					<p class="small" data-testid="save-state">
						{#if saved === 'yes'}Saved to the attempt log.{:else if saved === 'saving'}Saving…{:else}<span class="problem">Not saved: {saveProblem}</span> <button class="btn small" onclick={save}>Try again</button>{/if}
					</p>
				</div>
			</div>

			{#if graded.violations}
				<p class="roe big" data-testid="debrief-roe">
					{graded.violations} ROE {graded.violations === 1 ? 'violation' : 'violations'}. The grade is capped at D, as Ready or Not would cap it.
				</p>
			{/if}

			{#if misses.length}
				<p class="label">Misses</p>
				{#each misses as m (m.i)}
					<section class="sheet miss" data-testid="miss">
						<p class="meta"><a href="/tactics/scenario/{m.scenario.id}"><code>{m.scenario.id}</code></a> <span class="muted">{m.scenario.tags.join(' ')}</span></p>
						<div class="prose small-prose">{@html m.scenario.situationHtml}</div>
						<p class="small">
							You: <b>{answerText(m.scenario, m.answer)}</b>
							{#if m.judged.roe}<span class="badge warn">ROE</span>{/if}
							· Answer: <b>{answerText(m.scenario, m.scenario.answers[0])}</b>
						</p>
						{#if revealed[m.i]}
							<div class="why" data-testid="why">
								{#if m.scenario.whySuggested}<p class="badge warn">Suggested, not yet in your words</p>{/if}
								{#if m.scenario.whyHtml}<div class="prose">{@html m.scenario.whyHtml}</div>{:else}<p class="muted">No Why written yet.</p>{/if}
								<p class="muted small">
									Provenance: <b>{m.scenario.provenance}</b>
									{#if m.scenario.source} · {m.scenario.source}{/if}
									{#if m.scenario.verifiedVersion} · checked on {m.scenario.verifiedVersion}{:else} · not checked in game{/if}
								</p>
							</div>
						{:else}
							<label class="small" for="guess-{m.i}">Before you look: why do you think you missed it?</label>
							<textarea id="guess-{m.i}" class="field" rows="2" bind:value={guesses[m.i]} placeholder="Optional"></textarea>
							<button class="btn small" onclick={() => (revealed[m.i] = true)} data-testid="reveal-why">Show the why</button>
						{/if}
					</section>
				{/each}
			{:else}
				<p class="hint">No misses.</p>
			{/if}

			<p class="label">Tags</p>
			<ul class="rows tag-change" data-testid="tag-change">
				{#each tagChange as t (t.tag)}
					<li>
						<code>{t.tag}</code>
						<span class="num">{pct(t.before)} → <b>{pct(t.after)}</b></span>
						<span class="num {t.after >= t.before ? 'up' : 'down'}">{t.after >= t.before ? '+' : '−'}{Math.abs(Math.round((t.after - t.before) * 100))}</span>
					</li>
				{/each}
			</ul>

			<p class="label">Time</p>
			<ul class="times" data-testid="time-distribution">
				{#each played as p, i (i)}
					{@const span = p.scenario.timeLimitS * 1000 * TACTICS.overtime}
					<li>
						<code>{p.scenario.id}</code>
						<span class="track" aria-hidden="true">
							<i class="limit" style="left: {100 / TACTICS.overtime}%"></i>
							<i class="spent {p.judged.result}" style="width: {Math.min(100, (p.ms / span) * 100)}%"></i>
						</span>
						<span class="num small">{secs(p.ms)} / {p.scenario.timeLimitS}s</span>
					</li>
				{/each}
			</ul>

			<div class="actions">
				<button class="btn primary" onclick={() => goto(page.url.href, { invalidateAll: true })} data-testid="another-mission">Another mission</button>
				<a class="btn" href="/tactics">Back to Tactics</a>
			</div>
		</div>
	{/if}
</div>

<style>
	.mission { max-width: 760px; }
	.draft-note { color: var(--warn); }
	kbd { font: 10px var(--mono); border: 1px solid currentColor; border-radius: 3px; padding: 1px 4px; margin-left: 6px; opacity: 0.7; }
	.ready h2 { font-family: var(--serif); }

	.meta { display: flex; gap: var(--s3); font-size: var(--t12); color: var(--muted); margin: 0 0 var(--s2); flex-wrap: wrap; }
	.clock { height: 6px; border-radius: 3px; background: var(--soft); overflow: hidden; }
	.clock i { display: block; height: 100%; background: var(--accent); }
	.clock.late i { background: var(--warn); }
	.time { font-size: var(--t13); color: var(--muted); margin: var(--s1) 0 var(--s3); text-align: right; }
	.time.late { color: var(--warn); font-weight: 600; }
	.situation { margin-bottom: var(--s4); font-size: 17px; }
	.start-drill { display: flex; align-items: center; gap: var(--s3); margin-top: var(--s4); flex-wrap: wrap; }
	.options { list-style: none; padding: 0; margin: var(--s4) 0 0; display: grid; gap: var(--s2); }
	.option {
		display: flex; align-items: baseline; gap: var(--s3); width: 100%; text-align: left;
		font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--line);
		border-radius: var(--r); padding: var(--s3) var(--s4); cursor: pointer;
	}
	.option:hover:not(:disabled) { background: var(--soft); }
	.option:disabled { cursor: default; }
	.option em { font: 10px var(--mono); font-style: normal; color: var(--muted); width: 10px; }
	.option b { color: var(--accent); }
	.option.right { border-color: var(--ok); background: var(--ok-soft); }
	.option.chosen:not(.right) { border-color: var(--bad); background: var(--bad-soft); }

	.order { margin-top: var(--s3); display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); }
	.angle-keys { display: flex; gap: var(--s2); flex-wrap: wrap; width: 100%; }
	.angle-keys em { font: 10px var(--mono); font-style: normal; color: var(--muted); margin-right: 4px; }

	.verdict { margin-top: var(--s4); padding: var(--s3) var(--s4); border-radius: var(--r); border-left: 3px solid; }
	.verdict.good { background: var(--ok-soft); border-color: var(--ok); }
	.verdict.bad { background: var(--bad-soft); border-color: var(--bad); }
	.verdict p { margin: 0 0 var(--s2); }
	.roe { color: var(--bad); font-weight: 700; }
	.roe.big { background: var(--bad-soft); border-left: 3px solid var(--bad); padding: var(--s3) var(--s4); border-radius: var(--r-sm); }

	.grade-row { display: flex; gap: var(--s5); align-items: center; margin-bottom: var(--s4); }
	.grade-row p { margin: 0 0 var(--s1); }
	.grade { font: 700 64px/1 var(--serif); width: 88px; height: 88px; display: grid; place-items: center; border-radius: var(--r-lg); background: var(--soft); }
	.g-S, .g-A { color: var(--ok); }
	.g-B, .g-C { color: var(--warn); }
	.g-D { color: var(--bad); }

	.miss { margin-bottom: var(--s3); }
	.miss textarea { width: 100%; margin: var(--s1) 0 var(--s2); }
	.small-prose { font-size: var(--t14); }
	.why { border-top: 1px solid var(--line); margin-top: var(--s2); padding-top: var(--s2); }

	.tag-change { list-style: none; padding: 0; }
	.tag-change li { display: grid; grid-template-columns: 1fr auto 48px; gap: var(--s3); align-items: center; }
	.up { color: var(--ok); }
	.down { color: var(--bad); }

	.times { list-style: none; padding: 0; display: grid; gap: 6px; }
	.times li { display: grid; grid-template-columns: 90px 1fr 90px; gap: var(--s3); align-items: center; }
	.track { position: relative; height: 8px; background: var(--soft); border-radius: 4px; overflow: hidden; }
	.track .spent { position: absolute; inset: 0 auto 0 0; background: var(--accent); }
	.track .spent.late { background: var(--warn); }
	.track .spent.wrong, .track .spent.timeout { background: var(--bad); }
	.track .limit { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--text); opacity: 0.4; z-index: 1; }
	.actions { display: flex; gap: var(--s2); margin-top: var(--s5); }

	@media (max-width: 720px) {
		.option em, .angle-keys em, kbd { display: none; }
		.option { min-height: 48px; }
		.grade { font-size: 44px; width: 64px; height: 64px; }
	}
</style>
