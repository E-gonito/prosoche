import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { dailyNotePath, formatDay, isDayKey, shiftDay, today } from '$server/daily';
import { renderMarkdown } from '$server/render';
import { parseNote } from '$server/parse/note';
import { coveredMinutes, overlappingCount } from '$server/schedule';
import { workspaceFor } from '$server/workspaces';
import { CONFLICT_MARKERS } from '$server/index/index';
import { config } from '$server/config';
import { BRIEFING_MARKER } from '$server/ai/guardrails';
import { readRegion } from '$server/ai/proposal';
import { OPEN_STATUSES } from '$lib/shared/task';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	if (!isDayKey(params.day)) error(404, 'Not a date');
	const { vault, index, ready, workspaces } = hub();
	await ready;

	const path = dailyNotePath(params.day);
	const note = await vault.read(path);
	const tasks = index.tasksIn(path);

	// Shown in time order; the file keeps its own order untouched.
	const scheduled = tasks
		.filter((t) => !t.fenced && t.startMin !== null)
		.sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
	const unscheduled = tasks.filter((t) => !t.fenced && t.startMin === null);
	const backlog = tasks.filter((t) => t.fenced);

	// Open work from the rest of the vault, so a day can be filled from it.
	//
	// Two exclusions, both learned the hard way from this vault. Daily notes
	// are copies of one template, so every past day would contribute the same
	// unfinished checklist. And a `- [ ]` in a syllabus or a test plan is
	// checklist notation, not a task: a quadrant tag is what marks a line the
	// user actually intends to do, so that is what this asks for.
	const defs = await workspaces();
	const exclude = [`${config.hubFolder}/`];
	const elsewhere = index
		.findTasks({ statuses: OPEN_STATUSES, excludePrefixes: exclude, excludeDailyNotes: true, requireQuadrant: true, limit: 300 })
		.map((task) => ({ task, workspace: workspaceFor(defs, { path: task.path }) }));

	const groups = defs
		.map((w) => ({
			slug: w.slug,
			name: w.name,
			color: w.color,
			tasks: elsewhere.filter((e) => e.workspace?.slug === w.slug).map((e) => e.task)
		}))
		.filter((g) => g.tasks.length > 0);
	const unassigned = elsewhere.filter((e) => e.workspace === null).map((e) => e.task);

	/**
	 * Which workspace each of the day's own tasks belongs to, keyed
	 * `path:line`.
	 *
	 * Here rather than in the components because membership is a rule of the
	 * workspaces module — tag, then folder, then frontmatter, then a word in
	 * the task's own text — and a component that worked it out would be a
	 * second copy of that rule in another language of the app. A task no
	 * workspace claims is simply absent, so a missing key means no dot.
	 */
	const owners: Record<string, { slug: string; name: string; color: string }> = {};
	for (const task of [...scheduled, ...unscheduled]) {
		const owner = workspaceFor(defs, { path: task.path, tags: task.tags, text: task.text });
		if (owner) owners[`${task.path}:${task.line}`] = { slug: owner.slug, name: owner.name, color: owner.color };
	}

	return {
		day: params.day,
		label: formatDay(params.day),
		isToday: params.day === today(),
		prev: shiftDay(params.day, -1),
		next: shiftDay(params.day, 1),
		path,
		exists: note.exists,
		// An unfinished merge in the day's note, so the page can say so rather
		// than quietly showing half a day.
		conflicted: index.problemFor(path) === CONFLICT_MARKERS,
		scheduled,
		unscheduled,
		backlog,
		owners,
		plannedMinutes: coveredMinutes(scheduled),
		overlaps: overlappingCount(scheduled),
		groups,
		unassigned: unassigned.slice(0, 40),
		// The region as it stands in the note. Read like any other text, so a
		// briefing written by the timer, regenerated here, or typed by hand in
		// Obsidian all arrive the same way.
		briefing: note.exists ? readRegion(note.content, BRIEFING_MARKER) : null,
		html: note.exists ? renderMarkdown(parseNote(note.content, path).body, (t) => linkTo(index.resolveLink(t))) : ''
	};
};

function linkTo(path: string | null): string | null {
	return path ? `/notes/${path.split('/').map(encodeURIComponent).join('/')}` : null;
}
