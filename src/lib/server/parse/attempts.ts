/**
 * The tactics attempt log, one line per answered drill, in monthly files
 * under `Tactics/Attempts/`:
 *
 *     - 2026-10-20T21:14:03 ron-0001 answer:: B result:: in-time correct:: true ms:: 2310 roe:: false mission:: m-20261020-2114 device:: pc
 *
 * A bullet, a local timestamp, the scenario id, then Dataview-style inline
 * fields, so the log reads in Obsidian and queries in Dataview with no
 * export step. A `clear-order` answer is its angles joined by `>`
 * (`A1>A3>A2`); no answer is `-`. Lines this grammar does not read, a
 * heading or a note you wrote, are skipped, never rewritten: the log is
 * only ever appended to. Pure.
 */

import { RESULTS, type Attempt } from '$lib/shared/tactics';
import { scanInlineFields } from './inline-fields';

const LINE = /^[ \t]*[-*+][ \t]+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})[ \t]+([a-z0-9][a-z0-9-]*)(?=[ \t]|$)/;
const KEYS = ['answer', 'result', 'correct', 'ms', 'roe', 'mission', 'device', 'note'] as const;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** Every attempt in one log file, in file order. Lines that are not attempts are skipped. Pure. */
export function parseAttempts(content: string): Attempt[] {
	const out: Attempt[] = [];
	for (const line of content.split('\n')) {
		const m = LINE.exec(line);
		if (!m) continue;
		const fields: Record<string, string> = {};
		for (const hit of scanInlineFields(line, KEYS, 'note')) fields[hit.key] = line.slice(hit.valueStart, hit.valueEnd);
		const result = RESULTS.find((r) => r === fields.result);
		const ms = Number(fields.ms);
		if (!result || !Number.isFinite(ms)) continue;
		out.push({
			at: m[1],
			scenario: m[2],
			mission: fields.mission ?? '',
			answer: !fields.answer || fields.answer === '-' ? null : fields.answer.split('>'),
			result,
			correct: result === 'in-time' || result === 'late',
			ms,
			roe: fields.roe === 'true',
			device: fields.device === 'phone' ? 'phone' : 'pc'
		});
	}
	return out;
}

/** One attempt as its log line, without a newline; `parseAttempts` reads it back as the same attempt. Pure. */
export function formatAttempt(a: Attempt): string {
	const answer = a.answer?.length ? a.answer.join('>') : '-';
	return `- ${a.at} ${a.scenario} answer:: ${answer} result:: ${a.result} correct:: ${a.correct} ms:: ${Math.round(a.ms)} roe:: ${a.roe} mission:: ${a.mission} device:: ${a.device}`;
}

/** The monthly file an attempt at `at` belongs in, below the log folder: `2026-10.md`. Pure. */
export function logFileFor(at: string): string {
	return `${at.slice(0, 7)}.md`;
}

/** True for a local timestamp the log can hold. Pure. */
export function isStamp(value: unknown): value is string {
	return typeof value === 'string' && STAMP.test(value);
}
