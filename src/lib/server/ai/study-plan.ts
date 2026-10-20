/**
 * Planning one study step with Claude: roughly how long it takes, the first
 * thing to do, and the short parts it breaks into, so starting it is not a
 * leap into hours of unknown work.
 *
 * Nothing here writes. The answer becomes a proposal, one `revise` of the
 * subject's `Goals.md` pinned to the bytes it read, which sets the step's
 * `est::`, `first::` and `part::` sub-bullets (see `study/steps.ts`) and
 * nothing else; `proposal.apply` writes it once you accept. The model sees
 * the goals note, the subject's principles and the step's reading, as data
 * (G8), and answers in a fixed JSON shape (G6).
 */

import { findGoal, goalRefs, readGoals } from '../study/goals';
import { stepDetails, withStepDetails } from '../study/steps';
import { readReadingList } from '../study/reading';
import { wrapAsData, type Schema } from './guardrails';
import { gather, nothing, runDraft, type DraftOptions, type DraftResult } from './run';
import { newId } from './proposal';
import type { Proposal, RunStamp } from '$lib/shared/ai';
import type { StepDetails } from '$lib/shared/study';
import type { Subject } from '../study/subjects';
import type { Vault } from '../vault/index';

const SCHEMA: Schema = {
	type: 'object',
	fields: {
		est: { type: 'string', minLength: 1, maxLength: 40 },
		first: { type: 'string', minLength: 1, maxLength: 300 },
		parts: { type: 'array', maxItems: 5, of: { type: 'string', minLength: 1, maxLength: 240 } }
	}
};

/** What the model answers. */
type Plan = StepDetails;

/**
 * The prompt for one step. Pure. It names the step, its goal, the steps
 * around it, the repo its work happens in and what is on its reading list,
 * and asks for an estimate a learner can believe, a first move small enough
 * to start without deciding anything, and parts that each end in something
 * written down or run, never the solution itself.
 */
export function planPrompt(input: {
	subject: string;
	goal: string;
	step: string;
	due: string | null;
	others: string[];
	repo: string | null;
	reading: string[];
	sources: Array<{ path: string; text: string }>;
}): string {
	return [
		`Plan one step of the user's "${input.subject}" study plan, so it is easy to start.`,
		'',
		`Goal: ${input.goal}`,
		`Step: ${input.step}${input.due ? ` (due ${input.due})` : ''}`,
		...(input.repo ? [`Its work happens in the repo at ${input.repo}.`] : []),
		...(input.others.length ? ['The goal\'s other steps, in order:', ...input.others.map((o) => `- ${o}`)] : []),
		...(input.reading.length ? ['On their reading list for this goal:', ...input.reading.map((r) => `- ${r}`)] : []),
		'',
		'Answer with:',
		'- est: a realistic range of focused time for someone learning this, like "45–60m" or "2–3h". Count reading named in the step.',
		'- first: one concrete first move that takes under five minutes and needs no decision: the exact command to run, file to open',
		'  or page and section to read. Not "get familiar with" or "set up the environment".',
		'- parts: two to five parts in order, each about 15 to 30 minutes and each ending in something written down or run, so',
		'  the step can be stopped after any of them. Name files, commands and sections where you can.',
		'Never give the answer to the step or code that solves it: it is for learning. Keep any rule the step states, such as',
		'"without AI". If the step is vague about which project, say what to check rather than guessing.',
		'',
		wrapAsData(input.sources)
	].join('\n');
}

/**
 * The plan as one proposal: the step's details set under its task line in
 * `Goals.md`. Pure. Null when the line is no longer a task or the plan
 * changes nothing.
 */
export function planProposal(path: string, note: { content: string; hash: string }, line: number, plan: Plan, stamp: RunStamp): Proposal | null {
	const text = withStepDetails(note.content, line, plan);
	if (text === null || text === note.content) return null;
	const step = note.content.split('\n')[line].replace(/^\s*[-*+]\s+\[.\]\s+/, '').replace(/\s*📅.*$/, '');
	return {
		id: newId('plan'),
		feature: 'study-plan',
		stamp,
		summary: `An estimate of ${plan.est}, a first move and ${plan.parts.length} part${plan.parts.length === 1 ? '' : 's'} for "${step.slice(0, 80)}".`,
		edits: [
			{
				id: newId('edit'),
				kind: 'revise',
				path,
				text,
				expectedHash: note.hash,
				reason: 'The step gets est::, first:: and part:: sub-bullets; its own line and its other sub-bullets are unchanged.'
			}
		],
		accepted: []
	};
}

/**
 * Draft a plan for the step on `line` of `subject`'s `Goals.md`. Refuses,
 * as a problem to show, a line that is not one of its goals' steps. Side
 * effects: spawns the CLI, appends to the audit log. Never writes a note.
 */
export async function draftStepPlan(vault: Vault, subject: Subject, line: number, options: DraftOptions = {}): Promise<DraftResult> {
	const path = subject.files.goals;
	const destinations = [path];
	const note = await vault.read(path);
	const goals = await readGoals(vault, path);
	const goal = goals.goals.find((g) => g.milestones.some((m) => m.line === line));
	const step = goal?.milestones.find((m) => m.line === line);
	if (!goal || !step) return { ...nothing('That step is no longer in Goals.md. Reload and try again.'), destinations };

	const reading = await readReadingList(vault, subject);
	const titles = reading.groups
		.filter((g) => g.title !== 'Done')
		.flatMap((g) => g.items)
		.filter((item) => findGoal(goalRefs(goals), item.goal)?.name === goal.title)
		.map((item) => (item.url ? `${item.title} (${item.url})` : item.title));

	const run = await runDraft<Plan>(vault, {
		feature: 'study-plan',
		prompt: planPrompt({
			subject: subject.name,
			goal: goal.title,
			step: step.text,
			due: step.due,
			others: goal.milestones.filter((m) => m !== step).map((m) => m.text),
			repo: goal.repo,
			reading: titles,
			sources: await gather(vault, [path, subject.files.principles])
		}),
		system: 'You help one person start a study step. Answer only with JSON: {"est":"…","first":"…","parts":["…"]}.',
		schema: SCHEMA,
		paths: [path],
		note: 'step planned',
		cli: options.cli
	});
	if (!run.ok) return { ...nothing(run.problem), refusals: run.refusals, destinations };
	const proposal = planProposal(path, note, line, run.value, run.stamp);
	const unchanged = JSON.stringify(stepDetails(note.content, line)) === JSON.stringify(run.value);
	return { proposal, problem: proposal ? null : unchanged ? 'The plan is the same as the one already there.' : 'That step changed while it was being planned. Try again.', refusals: [], destinations };
}
