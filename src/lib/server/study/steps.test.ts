import { describe, expect, it } from 'vitest';
import { goalRepo, replanGoal, stepDetails, withStepDetails } from './steps';

const GOALS = `---
focus: Rust
---
## Rust
target:: 2026-12-13
repo:: ~/dev/leyline-front
- [ ] Exercise 1 📅 2026-10-09
	- est:: 2h
	- first:: Run \`cargo test rng\`
	- a note of mine
	- part:: Read chapter 3
	- part:: Translate the C
- [x] Done already 📅 2026-10-01
- [ ] Exercise 2 📅 2026-10-25
- [-] Skipped 📅 2026-10-05
- [ ] Undated

## Later
target:: 2027-01-01
- [ ] Not touched 📅 2026-10-01
`;

const line = (fragment: string) => GOALS.split('\n').findIndex((l) => l.includes(fragment));

describe('stepDetails', () => {
	it('reads est, first and the parts, ignoring other sub-bullets', () => {
		expect(stepDetails(GOALS, line('Exercise 1'))).toEqual({ est: '2h', first: 'Run `cargo test rng`', parts: ['Read chapter 3', 'Translate the C'] });
	});

	it('is empty for a step with none', () => {
		expect(stepDetails(GOALS, line('Exercise 2'))).toEqual({ est: null, first: null, parts: [] });
	});
});

describe('goalRepo', () => {
	it('reads repo:: under its own heading only', () => {
		expect(goalRepo(GOALS, line('## Rust'))).toBe('~/dev/leyline-front');
		expect(goalRepo(GOALS, line('## Later'))).toBeNull();
	});
});

describe('withStepDetails', () => {
	it('replaces the details and keeps every other line as it was', () => {
		const out = withStepDetails(GOALS, line('Exercise 1'), { est: '90m', first: 'Open rng.rs', parts: ['One'] })!;
		expect(stepDetails(out, line('Exercise 1'))).toEqual({ est: '90m', first: 'Open rng.rs', parts: ['One'] });
		expect(out).toContain('\t- a note of mine\n');
		expect(out.split('\n').filter((l) => !/(est|first|part)::/.test(l))).toEqual(GOALS.split('\n').filter((l) => !/(est|first|part)::/.test(l)));
	});

	it('adds details under a step with no sub-bullets, indented with a tab', () => {
		const out = withStepDetails(GOALS, line('Exercise 2'), { est: '1h', first: null, parts: [] })!;
		expect(out).toContain('- [ ] Exercise 2 📅 2026-10-25\n\t- est:: 1h\n- [-] Skipped');
	});

	it('refuses a line that is not a task', () => {
		expect(withStepDetails(GOALS, line('target:: 2026'), { est: '1h', first: null, parts: [] })).toBeNull();
	});
});

describe('replanGoal', () => {
	it('moves every open dated step by the same days, so the earliest late one is due today', () => {
		const planned = replanGoal(GOALS, line('## Rust'), '2026-10-20')!;
		expect(planned).toMatchObject({ shift: 11, steps: 2 });
		const lines = planned.content.split('\n');
		expect(lines[line('Exercise 1')]).toBe('- [ ] Exercise 1 📅 2026-10-20');
		expect(lines[line('Exercise 2')]).toBe('- [ ] Exercise 2 📅 2026-11-05');
		// Done, skipped, undated and other goals' steps keep their lines.
		for (const keep of ['Done already', 'Skipped', 'Undated', 'Not touched', 'target:: 2026-12-13', 'est:: 2h']) {
			expect(lines[line(keep)]).toBe(GOALS.split('\n')[line(keep)]);
		}
	});

	it('moves the target only when a step would pass it', () => {
		const planned = replanGoal(GOALS, line('## Rust'), '2026-12-20')!;
		expect(planned.content).toContain('target:: 2027-01-05');
	});

	it('is null when nothing is late', () => {
		expect(replanGoal(GOALS, line('## Rust'), '2026-10-01')).toBeNull();
	});
});
