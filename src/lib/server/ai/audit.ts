/**
 * G9's first half: the record of what the AI layer did.
 *
 * One line per run in `_hub/ai-log/YYYY-MM.md`, in a markdown table, because
 * the audit trail belongs to the user like everything else here: it opens in
 * Obsidian, it syncs with the vault, and it is readable by someone who has
 * never seen this codebase. A run that was refused is logged exactly like one
 * that succeeded - a guardrail firing is the most interesting thing that can
 * happen and the least useful thing to leave out.
 *
 * The log also carries the day's spend, which is what G7 reads to decide
 * whether there is any budget left. That is deliberate: the thing that
 * enforces the cap and the thing that shows the user the cap are the same
 * file, so they cannot disagree.
 *
 * `_hub/ai-log/` is in G4's always-denied set. Evidence is not editable by
 * the thing it is evidence about.
 */

import { config } from '../config';
import type { Vault } from '../vault/index';
import type { Effort, FeatureId, GuardrailId, Model, PermissionMode } from '$lib/shared/ai';

export interface AuditEntry {
	/** ISO instant. A run is an event, so this is a time, not a day label. */
	at: string;
	feature: FeatureId;
	model: Model;
	effort: Effort;
	permission: PermissionMode;
	/** Vault-relative paths the run read, proposed or wrote. */
	paths: string[];
	decision: 'answered' | 'proposed' | 'applied' | 'refused' | 'failed';
	/** The guardrails that fired, when the decision was a refusal. */
	guardrails: GuardrailId[];
	costUsd: number;
	durationMs: number;
	/** One line of context: the question, or why it was refused. */
	note: string;
}

const HEADER = [
	'| Time | Feature | Model | Effort | Mode | Decision | Guardrails | Cost | Took | Files | Note |',
	'|---|---|---|---|---|---|---|---|---|---|---|'
].join('\n');

/** `_hub/ai-log/2026-09.md` - one file a month keeps any one of them small. */
export function logPath(at: string): string {
	return `${config.hubFolder}/ai-log/${at.slice(0, 7)}.md`;
}

/**
 * Append one run to the month's log.
 *
 * Inputs: the vault and the entry. Output: the path written. Side effects:
 * writes one note, creating it with a heading and a table header when the
 * month is new.
 *
 * Never fails a run. Logging is the last thing that happens and a full disk
 * or a clashing write must not turn a good answer into an error, so a failed
 * append is swallowed and reported in the return value as an empty path -
 * the alternative, throwing, would lose the answer as well as the log line.
 */
export async function logRun(vault: Vault, entry: AuditEntry): Promise<string> {
	const path = logPath(entry.at);
	try {
		const note = await vault.read(path);
		const body = note.exists ? note.content.replace(/\s+$/, '') : `# AI runs, ${entry.at.slice(0, 7)}\n\n${HEADER}`;
		const result = await vault.write(path, `${body}\n${row(entry)}\n`, note.exists ? note.hash : undefined);
		return result.ok ? path : '';
	} catch {
		return '';
	}
}

/** One table row. Exported because the escaping is the fiddly part. */
export function row(entry: AuditEntry): string {
	const cells = [
		entry.at.slice(11, 16),
		entry.feature,
		entry.model,
		entry.effort,
		entry.permission,
		entry.decision,
		entry.guardrails.join(' ') || '-',
		`$${entry.costUsd.toFixed(4)}`,
		`${(entry.durationMs / 1000).toFixed(1)}s`,
		entry.paths.length ? entry.paths.map(cell).join('<br>') : '-',
		cell(entry.note)
	];
	return `| ${cells.join(' | ')} |`;
}

/** A pipe inside a cell would split the row, so it is escaped, not dropped. */
function cell(text: string): string {
	return text.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 160);
}

export interface DaySpend {
	/** Dollars spent on the given day. */
	usd: number;
	runs: number;
}

/**
 * What has been spent on a given day, read back out of the log.
 *
 * Inputs: the vault and a `YYYY-MM-DD` day. Output: the total and the count.
 * Side effects: reads one note; never writes.
 *
 * A row this version cannot parse contributes nothing rather than breaking
 * the sum, and a missing log is zero spent - which is the right answer for a
 * vault where the AI layer has never run. Deliberately reads the markdown
 * rather than keeping a counter in memory, so restarting the server does not
 * hand the day's budget back.
 */
export async function spentOn(vault: Vault, day: string): Promise<DaySpend> {
	const note = await vault.read(logPath(day));
	if (!note.exists) return { usd: 0, runs: 0 };

	let usd = 0;
	let runs = 0;
	for (const line of note.content.split('\n')) {
		if (!line.startsWith('|') || line.startsWith('|---')) continue;
		const cells = line.split('|').map((c) => c.trim());
		// Columns: '', time, feature, model, effort, mode, decision, guardrails, cost, ...
		const cost = cells[8];
		if (cost === undefined || !cost.startsWith('$')) continue;
		const value = Number(cost.slice(1));
		if (!Number.isFinite(value)) continue;
		usd += value;
		runs++;
	}
	return { usd, runs };
}

/**
 * Recent runs, newest first, for the settings page.
 *
 * Inputs: the vault, a day to take the month from, and how many to return.
 * Output: the raw table rows. Side effects: reads one note.
 *
 * Returns the lines as written rather than parsing them into objects: the
 * page shows the table, and a parser here would be a second grammar for the
 * same file with nothing to gain by it.
 */
export async function recentRuns(vault: Vault, day: string, limit = 20): Promise<string[]> {
	const note = await vault.read(logPath(day));
	if (!note.exists) return [];
	return note.content
		.split('\n')
		.filter((line) => line.startsWith('|') && !line.startsWith('|---') && !line.startsWith('| Time |'))
		.slice(-limit)
		.reverse();
}
