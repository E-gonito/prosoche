/**
 * The prompt that turns Claude, opened in the step's own repo, into a
 * Socratic tutor for one study step.
 *
 * Built here rather than by a model: everything it needs is already on the
 * Overview, so it is a template filled in the browser, free and instant,
 * and the conversation itself happens in Claude Code in the repo, where
 * Claude can read the code and run the boring parts. Pure.
 */

import type { StepDetails } from './study';

export interface TutorContext {
	subject: string;
	goal: string;
	step: string;
	due: string | null;
	details: StepDetails;
	repo: string | null;
	/** Titles, with links where there are any. */
	reading: string[];
}

/** The prompt to paste into Claude Code. Pure. */
export function tutorPrompt(c: TutorContext): string {
	const est = c.details.est ? ` It should take about ${c.details.est} of focused time.` : '';
	return [
		`Be my Socratic tutor for one step of my ${c.subject} study plan.`,
		'',
		'## The step',
		`${c.step}${c.due ? ` (due ${c.due})` : ''}`,
		`It is part of the goal "${c.goal}".${est}`,
		...(c.repo ? [`We are working in ${c.repo}. Read what you need in it, including any exercise notes and tests, before we start.`] : []),
		...(c.details.first ? ['', `My planned first move: ${c.details.first}`] : []),
		...(c.details.parts.length ? ['', 'My planned parts:', ...c.details.parts.map((p, i) => `${i + 1}. ${p}`)] : []),
		...(c.reading.length ? ['', 'Reading for this goal:', ...c.reading.map((r) => `- ${r}`)] : []),
		'',
		'## How to tutor me',
		'- Never give me the answer, and never write the code that solves the step. Ask me one question at a time and wait for my reply.',
		'- When I am stuck, give the smallest hint that gets me moving: a question, the name of a concept, a doc section, or the file and line to look at. Give a bigger hint only if I ask again.',
		'- Do the boring parts when I ask: installing tools, setup, build or environment errors that are not the point of the step, boilerplate, and running tests or commands. Say what you did in a line.',
		'- Start by asking what I already know, then get me doing the first move within five minutes. Keep to the step; park anything else.',
		'- If the step says "without AI", only explain concepts and check my reasoning; do not touch the code or run it for me.',
		'- Every 25 minutes or so, ask where I am against the parts, and help me stop at a clean point if I am out of time.',
		'- When I finish, ask me to explain it back in two or three sentences, correct anything wrong in what I say, and suggest one line for my notes.'
	].join('\n');
}

/** The command that opens Claude Code where the step's work happens, or null without a repo. Pure. */
export function tutorCommand(repo: string | null): string | null {
	return repo ? `cd ${repo} && claude` : null;
}
