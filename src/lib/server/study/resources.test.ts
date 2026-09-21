import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { NoteIndex } from '../index/index';
import { isResource, queue, resources, setStatus, toResource, writeField } from './resources';
import type { Resource, TopicCoverage } from '$lib/shared/study';

/** The shape the real vault uses: one `media_link:` and a `#Video` tag. */
const STUB = '---\nmedia_link: https://youtu.be/abc\n---\n#Video\n';
const WATCHED = `---\nmedia_link: https://youtu.be/xyz\n---\n#Video\n\n${'Notes about what the video said, at length. '.repeat(4)}`;

describe('recognising a resource', () => {
	it('accepts the note this vault actually writes', () => {
		expect(isResource('CS/Resources/Video. Thing.md', { media_link: 'https://youtu.be/a' }, ['Video'])).toBe(true);
	});

	it('accepts a note named for its kind even with no frontmatter', () => {
		expect(isResource('CS/Video. Thing.md', {}, [])).toBe(true);
	});

	it('accepts the frontmatter the specification proposed', () => {
		expect(isResource('CS/Thing.md', { type: 'resource' }, [])).toBe(true);
	});

	it('leaves an ordinary note alone', () => {
		expect(isResource('CS/Pointers.md', {}, ['cs'])).toBe(false);
	});
});

describe('inferring what the vault does not say', () => {
	const raw = (over: Partial<Parameters<typeof toResource>[0]> = {}) =>
		toResource({
			path: 'CS/Resources/Video. Thing.md',
			title: 'Video. Thing',
			frontmatter: { media_link: 'https://youtu.be/abc' },
			tags: ['Video'],
			body: '#Video\n',
			updatedMs: 0,
			tasksDone: 0,
			tasksTotal: 0,
			...over
		});

	it('calls a note that is only a link queued', () => {
		expect(raw()).toMatchObject({ status: 'queued', stated: false, progress: 0, kind: 'video' });
	});

	it('calls a note full of the user’s own writing learning', () => {
		expect(raw({ body: 'A'.repeat(200) })).toMatchObject({ status: 'learning', stated: false });
	});

	it('does not mistake a wall of links and tags for writing', () => {
		const links = '#Video\n' + '[a](https://example.com/very/long/link) '.repeat(10);
		expect(raw({ body: links }).status).toBe('queued');
	});

	it('believes a stated status over anything it could infer', () => {
		expect(raw({ frontmatter: { status: 'paused' }, body: 'A'.repeat(500) })).toMatchObject({
			status: 'paused',
			stated: true
		});
	});

	it('reads progress from the note’s own task list', () => {
		expect(raw({ tasksDone: 3, tasksTotal: 4 })).toMatchObject({ progress: 75, status: 'learning' });
	});

	it('calls a resource whose tasks are all done, done', () => {
		expect(raw({ tasksDone: 4, tasksTotal: 4 })).toMatchObject({ status: 'done', progress: 100 });
	});

	it('takes the url from media_link, which is the key this vault uses', () => {
		expect(raw().url).toBe('https://youtu.be/abc');
	});

	it('falls back to the first link in the body', () => {
		expect(raw({ frontmatter: {}, body: 'See https://example.com/x for more.' }).url).toBe('https://example.com/x');
	});

	it('files a resource under every folder it lives in', () => {
		expect(raw().topics).toEqual(['cs', 'cs/resources']);
	});

	it('adds the topics the note names to the folders it lives in', () => {
		expect(raw({ frontmatter: { topics: ['Operating Systems'] } }).topics).toContain('operating-systems');
	});
});

describe('writeField', () => {
	it('replaces a field in place and leaves every other line alone', () => {
		const before = '---\nmedia_link: https://a\nstatus: queued\ntags: [x]\n---\n\nBody\n';
		expect(writeField(before, 'status', 'learning')).toBe('---\nmedia_link: https://a\nstatus: learning\ntags: [x]\n---\n\nBody\n');
	});

	it('inserts a missing field at the end of the frontmatter', () => {
		expect(writeField('---\nmedia_link: https://a\n---\n#Video\n', 'status', 'done')).toBe(
			'---\nmedia_link: https://a\nstatus: done\n---\n#Video\n'
		);
	});

	it('gives a note with no frontmatter one, without touching the body', () => {
		expect(writeField('# Thing\n\nBody\n', 'status', 'queued')).toBe('---\nstatus: queued\n---\n# Thing\n\nBody\n');
	});

	it('treats an unclosed fence as no frontmatter rather than mangling it', () => {
		expect(writeField('---\nhalf typed\n', 'status', 'queued')).toBe('---\nstatus: queued\n---\n---\nhalf typed\n');
	});
});

describe('the queue', () => {
	const make = (over: Partial<Resource>): Resource => ({
		path: 'x.md',
		title: 'x',
		kind: 'video',
		url: null,
		status: 'queued',
		stated: false,
		progress: 0,
		topics: [],
		added: null,
		updatedMs: 0,
		tasksDone: 0,
		tasksTotal: 0,
		...over
	});

	it('puts what you started before what you have not', () => {
		const out = queue([make({ title: 'b' }), make({ title: 'a', status: 'learning' })]);
		expect(out.map((r) => r.title)).toEqual(['a', 'b']);
	});

	it('leaves paused and finished things out entirely', () => {
		const out = queue([make({ title: 'a', status: 'paused' }), make({ title: 'b', status: 'done' })]);
		expect(out).toEqual([]);
	});

	it('prefers the resource that fills a gap in the topic map', () => {
		const cover = [
			{ id: 'covered', state: 'covered' },
			{ id: 'empty', state: 'gap' }
		] as TopicCoverage[];
		const out = queue([make({ title: 'a', topics: ['covered'] }), make({ title: 'b', topics: ['empty'] })], cover);
		expect(out.map((r) => r.title)).toEqual(['b', 'a']);
	});

	it('drains the oldest capture first when nothing else separates them', () => {
		const out = queue([make({ title: 'new', added: '2026-09-01' }), make({ title: 'old', added: '2025-01-01' })]);
		expect(out.map((r) => r.title)).toEqual(['old', 'new']);
	});

	it('orders by title when everything else ties, so it never shuffles', () => {
		const out = queue([make({ title: 'b' }), make({ title: 'a' })]);
		expect(out.map((r) => r.title)).toEqual(['a', 'b']);
	});
});

describe('reading and writing the vault', () => {
	let root: string;
	let vault: Vault;
	let index: NoteIndex;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-res-'));
		vault = new Vault(root);
		index = new NoteIndex(':memory:');
		await vault.write('CS/Resources/Video. Stub.md', STUB);
		await vault.write('CS/Resources/Video. Watched.md', WATCHED);
		await vault.write('CS/Pointers.md', '# Pointers\n\nNot a resource.\n');
		await vault.write('Art/Video. Painting.md', STUB);
		for (const path of await vault.list()) {
			const note = await vault.read(path);
			index.put(path, note.content, note.mtimeMs, note.hash);
		}
	});
	afterEach(async () => {
		index.close();
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('finds the resources and not the ordinary notes', async () => {
		const found = await resources(vault, index);
		expect(found.map((r) => r.title).sort()).toEqual(['Video. Painting', 'Video. Stub', 'Video. Watched']);
	});

	it('scopes to a folder, so the same widget serves two workspaces', async () => {
		const art = await resources(vault, index, { folders: ['Art'] });
		expect(art.map((r) => r.title)).toEqual(['Video. Painting']);
	});

	it('writes one line when a status is set, and reads it back as stated', async () => {
		const before = (await vault.read('CS/Resources/Video. Stub.md')).content.split('\n');
		const result = await setStatus(vault, index, 'CS/Resources/Video. Stub.md', 'learning');
		expect(result).toMatchObject({ ok: true, resource: { status: 'learning', stated: true } });

		const after = (await vault.read('CS/Resources/Video. Stub.md')).content.split('\n');
		expect(after).toEqual(['---', 'media_link: https://youtu.be/abc', 'status: learning', '---', '#Video', '']);
		expect(after.filter((l) => !l.startsWith('status:'))).toEqual(before);
	});

	it('refuses a status that is not one of the four', async () => {
		const result = await setStatus(vault, index, 'CS/Resources/Video. Stub.md', 'nonsense' as never);
		expect(result).toEqual({ ok: false, reason: 'bad-status' });
		expect((await vault.read('CS/Resources/Video. Stub.md')).content).toBe(STUB);
	});

	it('reports a missing note rather than creating one', async () => {
		expect(await setStatus(vault, index, 'CS/Nope.md', 'done')).toEqual({ ok: false, reason: 'no-note' });
		expect((await vault.read('CS/Nope.md')).exists).toBe(false);
	});
});
