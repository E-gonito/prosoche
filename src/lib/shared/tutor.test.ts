import { describe, expect, it } from 'vitest';
import { tutorCommand, tutorPrompt } from './tutor';

const base = {
	subject: 'Computer Science',
	goal: 'Rust via leyline-front',
	step: 'Exercise 1: implement PCG32',
	due: '2026-10-25',
	details: { est: '2h', first: 'Run `cargo test rng`', parts: ['Read chapter 3', 'Translate the C'] },
	repo: '~/dev/leyline-front',
	reading: ['The Rust Book (https://doc.rust-lang.org/book/)']
};

describe('tutorPrompt', () => {
	it('carries the step, its plan and the repo, and the tutoring rules', () => {
		const prompt = tutorPrompt(base);
		for (const part of ['Exercise 1: implement PCG32 (due 2026-10-25)', 'about 2h', '~/dev/leyline-front', 'Run `cargo test rng`', '2. Translate the C', 'The Rust Book', 'Never give me the answer']) {
			expect(prompt).toContain(part);
		}
	});

	it('leaves out what the step does not have', () => {
		const prompt = tutorPrompt({ ...base, due: null, details: { est: null, first: null, parts: [] }, repo: null, reading: [] });
		expect(prompt).not.toMatch(/\(due |It should take about|We are working in|My planned first move|My planned parts|Reading for this goal/);
	});
});

describe('tutorCommand', () => {
	it('opens Claude Code in the repo, or nothing without one', () => {
		expect(tutorCommand('~/dev/leyline-front')).toBe('cd ~/dev/leyline-front && claude');
		expect(tutorCommand(null)).toBeNull();
	});
});
