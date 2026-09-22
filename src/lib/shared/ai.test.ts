import { describe, it, expect } from 'vitest';
import {
	changedLines,
	diffLines,
	estimateTokens,
	FEATURE_DEFAULTS,
	GUARDRAILS,
	MODELS,
	PERMISSION_MODES,
	refuse,
	scopeLabel
} from './ai';

describe('the pickers', () => {
	it('offers the current model ids', () => {
		expect(MODELS.map((m) => m.id)).toEqual([
			'claude-opus-5-5',
			'claude-opus-5',
			'claude-sonnet-5',
			'claude-haiku-4-5-20251001',
			'claude-fable-5-1'
		]);
	});

	it('offers no mode that bypasses permissions', () => {
		const ids = PERMISSION_MODES.map((m) => m.id).join(' ');
		expect(ids).not.toMatch(/bypass|skip|dangerous|yolo/i);
		expect(PERMISSION_MODES).toHaveLength(3);
	});

	it('defaults every feature to something cautious', () => {
		for (const [feature, run] of Object.entries(FEATURE_DEFAULTS)) {
			expect(run.permission, feature).not.toBe('apply');
			expect(run.budgetUsd, feature).toBeGreaterThan(0);
			expect(run.timeoutSeconds, feature).toBeGreaterThan(0);
		}
	});

	it('names all ten guardrails', () => {
		expect(Object.keys(GUARDRAILS)).toHaveLength(10);
	});
});

describe('refuse', () => {
	it('carries the guardrail name so the UI needs no lookup', () => {
		expect(refuse('G4', 'nope', 'a.md')).toEqual({
			guardrail: 'G4',
			title: 'Path policy',
			message: 'nope',
			path: 'a.md'
		});
	});

	it('leaves the path off when no one file is at fault', () => {
		expect(refuse('G7', 'spent')).not.toHaveProperty('path');
	});
});

describe('scopeLabel', () => {
	it('names each scope in words', () => {
		expect(scopeLabel({ kind: 'vault' })).toBe('Whole vault');
		expect(scopeLabel({ kind: 'workspace', slug: 'work' })).toContain('work');
		expect(scopeLabel({ kind: 'folder', path: 'Study' })).toContain('Study');
		expect(scopeLabel({ kind: 'note', path: 'a.md' })).toContain('a.md');
	});
});

describe('diffLines', () => {
	it('is all same lines for an unchanged file', () => {
		const rows = diffLines('a\nb\nc', 'a\nb\nc');
		expect(rows.every((r) => r.kind === 'same')).toBe(true);
		expect(rows).toHaveLength(3);
	});

	it('marks one added line and leaves the rest alone', () => {
		const rows = diffLines('a\nb', 'a\nnew\nb');
		expect(rows.map((r) => `${r.kind}:${r.text}`)).toEqual(['same:a', 'add:new', 'same:b']);
	});

	it('marks one removed line', () => {
		const rows = diffLines('a\ngone\nb', 'a\nb');
		expect(rows.filter((r) => r.kind === 'remove').map((r) => r.text)).toEqual(['gone']);
	});

	it('handles a file that did not exist', () => {
		const rows = diffLines('', 'first\nsecond');
		expect(rows.every((r) => r.kind === 'add')).toBe(true);
		expect(rows).toHaveLength(2);
	});

	it('finds a one-line change in a long file without marking the rest', () => {
		const before = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
		const after = before.replace('line 250', 'line 250 changed');
		const rows = diffLines(before, after);
		expect(rows.filter((r) => r.kind !== 'same')).toHaveLength(2);
	});
});

describe('changedLines', () => {
	it('counts what a rewrite would remove, against what was there', () => {
		const before = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
		const after = 'line 0\nline 1';
		expect(changedLines(before, after)).toEqual({ removed: 8, added: 0, of: 10 });
	});

	it('reports nothing was there for a new file', () => {
		expect(changedLines('', 'hello').of).toBe(0);
	});
});

describe('estimateTokens', () => {
	it('is four characters to the token, rounded up', () => {
		expect(estimateTokens('')).toBe(0);
		expect(estimateTokens('abc')).toBe(1);
		expect(estimateTokens('a'.repeat(400))).toBe(100);
	});
});
