/**
 * What the focus session's server module and its screens both need. Shared
 * because a component must not import `$server`.
 */

/** How long Start commits to, in minutes, until Settings says otherwise. */
export const DEFAULT_WARMUP_MINUTES = 5;

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "Just five minutes": the warm-up as the screens say it, in words up to ten and digits after. Pure. */
export function justMinutes(minutes: number): string {
	return `Just ${WORDS[minutes] ?? minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}
