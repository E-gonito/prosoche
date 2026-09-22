import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitSync, UNTRACK_SUBJECT, commitSubject, isTransient } from './git-sync';

describe('commitSubject', () => {
	it('names a single file', () => {
		expect(commitSubject(['Journal/2026/09/21.md'])).toBe('hub: 1 file (21.md)');
	});

	it('lists up to three and counts the rest', () => {
		expect(commitSubject(['a/1.md', 'b/2.md', 'c/3.md', 'd/4.md', 'e/5.md'])).toBe(
			'hub: 5 files (1.md, 2.md, 3.md, +2 more)'
		);
	});

	it('is distinguishable from a hand-written commit', () => {
		expect(commitSubject(['x.md']).startsWith('hub: ')).toBe(true);
	});
});

describe('transient state', () => {
	it('is written to the vault but never committed', () => {
		// A running timer has to survive a restart, so it is a file; but a
		// commit per start and stop would bury the user's real history.
		expect(isTransient('_hub/timer.json')).toBe(true);
		expect(isTransient('_hub/.state/anything.json')).toBe(true);
		expect(isTransient('_hub/workspaces/work.md')).toBe(false);
		expect(isTransient('Journal/2026/09/21.md')).toBe(false);
	});
});

describe('GitSync against a real remote', () => {
	// The shape that broke a real vault: a hub on another device committed the
	// schedule stamp, and the pull here was refused because an untracked copy
	// of the same file sat in the working tree.
	it('pulls over an untracked copy of transient state another device committed, then untracks it', async () => {
		const root = await mkdtemp(join(tmpdir(), 'prosoche-sync-'));
		const remote = join(root, 'remote.git');
		const ours = join(root, 'ours');
		const theirs = join(root, 'theirs');
		const git = (dir: string, ...args: string[]) =>
			execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' })
				.toString()
				.trim();

		execFileSync('git', ['init', '-q', '--bare', '-b', 'master', remote]);
		execFileSync('git', ['init', '-q', '-b', 'master', ours]);
		git(ours, 'config', 'user.name', 't');
		git(ours, 'config', 'user.email', 't@t');
		git(ours, 'remote', 'add', 'origin', remote);
		await writeFile(join(ours, 'Notes.md'), '# Notes\n');
		git(ours, 'add', '-A');
		git(ours, 'commit', '-q', '-m', 'seed');
		git(ours, 'push', '-q', '-u', 'origin', 'master');

		execFileSync('git', ['clone', '-q', remote, theirs]);
		await mkdir(join(theirs, '_hub/.state'), { recursive: true });
		await writeFile(join(theirs, '_hub/.state/schedule.json'), '{ "briefing": "2026-09-22" }\n');
		git(theirs, 'add', '-A');
		git(theirs, 'commit', '-q', '-m', 'hub: 1 file (schedule.json)');
		git(theirs, 'push', '-q', 'origin', 'master');

		await mkdir(join(ours, '_hub/.state'), { recursive: true });
		await writeFile(join(ours, '_hub/.state/schedule.json'), '{ "briefing": "2026-09-21" }\n');

		const sync = new GitSync(ours);
		const status = await sync.pull();

		expect(status.error).toBeNull();
		// Their copy came in; the stale local copy was not worth refusing a pull over.
		expect(await readFile(join(ours, '_hub/.state/schedule.json'), 'utf8')).toBe('{ "briefing": "2026-09-22" }\n');
		// The file is still on disk but no longer tracked, here or on the remote.
		expect(git(ours, 'ls-files', '--', '_hub')).toBe('');
		expect(git(remote, 'log', '-1', '--format=%s', 'master')).toBe(UNTRACK_SUBJECT);
		expect(git(remote, 'ls-tree', '-r', '--name-only', 'master')).not.toContain('_hub/.state');
		expect(await readFile(join(ours, '.gitignore'), 'utf8')).toBe('_hub/timer.json\n_hub/.state/\n');
		// A second pull has nothing to do and changes nothing.
		expect((await sync.pull()).error).toBeNull();
		expect(git(remote, 'log', '--format=%s', 'master').split('\n')).toHaveLength(3);

		await rm(root, { recursive: true, force: true });
	});
});
