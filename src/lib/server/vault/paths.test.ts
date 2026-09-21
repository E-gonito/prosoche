import { describe, it, expect } from 'vitest';
import { toAbsolute, toRelative, isIgnored, isMarkdown, PathOutsideVaultError } from './paths';

const VAULT = '/tmp/vault';

describe('toAbsolute', () => {
	it('resolves a normal note', () => {
		expect(toAbsolute('Journal/2026/09/21.md', VAULT)).toBe('/tmp/vault/Journal/2026/09/21.md');
	});

	it('refuses to climb out of the vault', () => {
		expect(() => toAbsolute('../secrets.md', VAULT)).toThrow(PathOutsideVaultError);
		expect(() => toAbsolute('Journal/../../etc/passwd', VAULT)).toThrow(PathOutsideVaultError);
	});

	it('refuses an absolute path', () => {
		expect(() => toAbsolute('/etc/passwd', VAULT)).toThrow(PathOutsideVaultError);
	});

	it('allows a path that climbs but stays inside', () => {
		expect(toAbsolute('Journal/../Inbox/note.md', VAULT)).toBe('/tmp/vault/Inbox/note.md');
	});
});

describe('toRelative', () => {
	it('round-trips', () => {
		expect(toRelative(toAbsolute('Work/Client Notes/Handbook.md', VAULT), VAULT)).toBe(
			'Work/Client Notes/Handbook.md'
		);
	});
});

describe('isIgnored and isMarkdown', () => {
	it('skips vault machinery and generated drawings', () => {
		expect(isIgnored('.obsidian/plugins/obsidian-git/main.js')).toBe(true);
		expect(isIgnored('.stversions/Inbox/testing.md')).toBe(true);
		expect(isIgnored('Excalidraw/Drawing.md')).toBe(true);
		expect(isIgnored('Journal/2026/09/21.md')).toBe(false);
	});

	it('accepts only markdown outside ignored folders', () => {
		expect(isMarkdown('Journal/2026/09/21.md')).toBe(true);
		expect(isMarkdown('Images/Pasted image.png')).toBe(false);
		expect(isMarkdown('Flashcards/Computer Science/Computer Science.txt')).toBe(false);
		expect(isMarkdown('.obsidian/app.json')).toBe(false);
	});
});
