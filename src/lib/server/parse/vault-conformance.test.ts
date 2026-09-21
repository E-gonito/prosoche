import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scanTasks, rewriteTaskLine } from './task';

/**
 * Runs the parser over an entire real vault. Its job is not to check any one
 * line but to prove a safety property: rewriting a task with the values it
 * already has returns the original bytes. If that ever fails, the app would
 * silently reformat notes the moment it saved one.
 *
 * Point it at your own vault to run it:
 *
 *     VAULT_PATH=~/vault npm test
 *
 * Skipped otherwise, so a checkout with no vault still has a green suite.
 */
const VAULT = process.env.VAULT_PATH ?? '';
const SKIP = ['.git', '.obsidian', '.stversions', '.stfolder', 'node_modules'];

function markdownFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (SKIP.includes(entry)) continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) markdownFiles(path, out);
		else if (entry.endsWith('.md')) out.push(path);
	}
	return out;
}

// `describe.skipIf` still runs the callback body, so the scan has to be
// guarded rather than relying on the skip.
const ENABLED = Boolean(VAULT) && existsSync(VAULT);

describe.skipIf(!ENABLED)('a real vault', () => {
	const files = ENABLED ? markdownFiles(VAULT) : [];
	const tasks = files.flatMap((f) => scanTasks(readFileSync(f, 'utf8')).map((t) => ({ file: f, t })));

	it('has tasks to parse', () => {
		expect(tasks.length).toBeGreaterThan(100);
	});

	it('rewrites every task to the identical bytes when nothing changes', () => {
		const drifted = tasks.filter(({ t }) => rewriteTaskLine(t.raw, {}) !== t.raw);
		expect(drifted.map(({ file, t }) => `${file}: ${t.raw}`)).toEqual([]);
	});

	it('round-trips every task through its own values', () => {
		const drifted = tasks.filter(
			({ t }) =>
				rewriteTaskLine(t.raw, {
					status: t.status,
					time: t.start && t.end ? { start: t.start, end: t.end } : undefined,
					quadrant: t.quadrant ?? undefined
				}) !== t.raw
		);
		expect(drifted.map(({ file, t }) => `${file}: ${JSON.stringify(t.raw)}`)).toEqual([]);
	});

	// The new edits in phase 2 reach further into the line than ticking a
	// checkbox does, so each one is proved against every real task rather than
	// against a handful of fixtures.
	it('round-trips every task through its own text, tags and fields', () => {
		const drifted = tasks.filter(
			({ t }) =>
				rewriteTaskLine(t.raw, {
					text: t.text,
					due: t.due,
					id: t.id,
					blockedBy: t.blockedBy,
					addTags: t.tags
				}) !== t.raw
		);
		expect(drifted.map(({ file, t }) => `${file}: ${JSON.stringify(t.raw)}`)).toEqual([]);
	});

	it('returns the original bytes after a tag is added and removed again', () => {
		const drifted = tasks.filter(({ t }) => {
			const pinned = rewriteTaskLine(t.raw, { addTags: ['prosoche-probe'] });
			return rewriteTaskLine(pinned, { removeTags: ['prosoche-probe'] }) !== t.raw;
		});
		expect(drifted.map(({ file, t }) => `${file}: ${JSON.stringify(t.raw)}`)).toEqual([]);
	});

	it('never loses a character of the words when a task is renamed', () => {
		// A rename replaces one span. Anything the parser mistook for metadata
		// would vanish here, so the check is that the line only ever grows by
		// the difference in wording.
		const lost = tasks.filter(({ t }) => {
			const renamed = rewriteTaskLine(t.raw, { text: `${t.text} and one more thing` });
			return renamed !== t.raw.replace(t.text, `${t.text} and one more thing`) && t.text !== '';
		});
		expect(lost.map(({ file, t }) => `${file}: ${JSON.stringify(t.raw)}`)).toEqual([]);
	});

	it('only ever reads quadrants in range', () => {
		const seen = [...new Set(tasks.map(({ t }) => t.quadrant).filter((q) => q !== null))].sort();
		expect(seen.every((q) => q >= 1 && q <= 4)).toBe(true);
	});
});
