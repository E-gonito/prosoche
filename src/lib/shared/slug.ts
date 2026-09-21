/**
 * Turning a name into the slug used for a file, a tag, a column key or a URL.
 *
 * It lives in `shared/` because both sides need the same answer at the same
 * moment: the new-workspace form shows the slug as you type, and the server
 * writes the file with it. Two implementations would disagree the first time
 * someone typed an accent.
 */

/** Lowercase, punctuation collapsed to single hyphens, trimmed, at most 48 characters. */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48)
		.replace(/-+$/, '');
}
