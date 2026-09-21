/**
 * Vault-relative path handling.
 *
 * Every path crossing a module boundary in this codebase is vault-relative and
 * POSIX-separated, e.g. `Journal/2026/09/21.md`. Absolute paths exist only
 * inside the vault module. Callers therefore cannot construct a path that
 * escapes the vault, because `toAbsolute` rejects anything that would.
 */

import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import { config } from '../config';

export class PathOutsideVaultError extends Error {
	constructor(path: string) {
		super(`Path escapes the vault: ${path}`);
		this.name = 'PathOutsideVaultError';
	}
}

/** Resolve a vault-relative path to an absolute one, or throw if it escapes. */
export function toAbsolute(vaultRelative: string, vaultPath = config.vaultPath): string {
	if (isAbsolute(vaultRelative)) throw new PathOutsideVaultError(vaultRelative);
	const absolute = normalize(join(vaultPath, vaultRelative));
	const rel = relative(vaultPath, absolute);
	if (rel.startsWith('..') || isAbsolute(rel)) throw new PathOutsideVaultError(vaultRelative);
	return absolute;
}

/** Convert an absolute path inside the vault back to a vault-relative one. */
export function toRelative(absolute: string, vaultPath = config.vaultPath): string {
	return relative(vaultPath, absolute).split(sep).join('/');
}

/** True when any segment of the path is an ignored directory. */
export function isIgnored(vaultRelative: string): boolean {
	return vaultRelative.split('/').some((segment) => (config.ignoredDirs as readonly string[]).includes(segment));
}

/** True for the markdown files the hub reads and indexes. */
export function isMarkdown(vaultRelative: string): boolean {
	return vaultRelative.endsWith('.md') && !isIgnored(vaultRelative);
}
