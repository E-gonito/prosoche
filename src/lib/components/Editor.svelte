<script lang="ts">
	/**
	 * The note editor.
	 *
	 * Saves are debounced and also bound to Cmd/Ctrl+S. A save carries the hash
	 * the note was opened with, so a clash with another device comes back as a
	 * conflict the user resolves rather than an overwrite they never saw.
	 */
	import { onDestroy, untrack } from 'svelte';
	import { EditorState, type Extension } from '@codemirror/state';
	import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
	import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
	import { markdown } from '@codemirror/lang-markdown';
	import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
	import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
	import Icon from '$lib/components/Icon.svelte';
	import { livePreview } from '$lib/client/editor/live-preview';
	import { asCard, asCloze, asWikilink, wrap, type TextEdit } from '$lib/client/editor/commands';
	import { saveNote } from '$lib/client/api';

	let {
		path,
		content,
		hash,
		noteNames = [],
		onnavigate
	}: {
		path: string;
		content: string;
		hash: string;
		noteNames?: string[];
		onnavigate?: (target: string) => void;
	} = $props();

	let host: HTMLDivElement;
	let view: EditorView | null = null;
	// Deliberately a snapshot: after the first save the editor tracks its own
	// base hash, and the prop is only the starting point. The page keys this
	// component on `path`, so navigating to another note remounts it.
	let baseHash = $state(untrack(() => hash));
	let status = $state<'saved' | 'dirty' | 'saving' | 'error'>('saved');
	let message = $state('');
	let conflict = $state<{ theirs: string; theirHash: string } | null>(null);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	const SAVE_DEBOUNCE_MS = 1500;

	function wikilinkCompletions(context: CompletionContext) {
		const before = context.matchBefore(/\[\[([^\]|#]*)$/);
		if (!before) return null;
		const typed = before.text.slice(2).toLowerCase();
		return {
			from: before.from + 2,
			options: noteNames
				.filter((name) => name.toLowerCase().includes(typed))
				.slice(0, 40)
				.map((name) => ({ label: name, type: 'text', apply: `${name}]]` }))
		};
	}

	function extensions(): Extension[] {
		return [
			history(),
			keymap.of([
				{
					key: 'Mod-s',
					preventDefault: true,
					run: () => {
						void save();
						return true;
					}
				},
				...defaultKeymap,
				...historyKeymap,
				indentWithTab
			]),
			markdown(),
			syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
			livePreview((target) => onnavigate?.(target)),
			autocompletion({ override: [wikilinkCompletions] }),
			cmPlaceholder('Write…'),
			EditorView.lineWrapping,
			EditorView.updateListener.of((update) => {
				if (!update.docChanged) return;
				status = 'dirty';
				message = '';
				if (saveTimer) clearTimeout(saveTimer);
				saveTimer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
			})
		];
	}

	$effect(() => {
		if (!host || view) return;
		view = new EditorView({ state: EditorState.create({ doc: content, extensions: extensions() }), parent: host });
		return () => {
			view?.destroy();
			view = null;
		};
	});

	onDestroy(() => {
		if (saveTimer) clearTimeout(saveTimer);
		view?.destroy();
		view = null;
	});

	async function save() {
		if (!view || status === 'saving') return;
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		const text = view.state.doc.toString();
		status = 'saving';
		const result = await saveNote(path, text, baseHash);

		if (result.ok) {
			baseHash = result.value.hash;
			status = view.state.doc.toString() === text ? 'saved' : 'dirty';
			message = '';
			return;
		}
		status = 'error';
		message = result.message;
		if (result.kind === 'conflict' && 'current' in result) {
			conflict = { theirs: result.current, theirHash: result.currentHash };
		}
	}

	/** Overwrite the other device's version with what is on screen. */
	async function keepMine() {
		if (!conflict) return;
		baseHash = conflict.theirHash;
		conflict = null;
		await save();
	}

	/** Discard local edits and load the other device's version. */
	function takeTheirs() {
		if (!view || !conflict) return;
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: conflict.theirs } });
		baseHash = conflict.theirHash;
		conflict = null;
		status = 'saved';
		message = '';
	}

	function applyEdit(make: (doc: string, from: number, to: number) => TextEdit) {
		if (!view) return;
		const { from, to } = view.state.selection.main;
		const edit = make(view.state.doc.toString(), from, to);
		view.dispatch({
			changes: { from: edit.from, to: edit.to, insert: edit.insert },
			selection: { anchor: edit.selectFrom, head: edit.selectTo }
		});
		view.focus();
	}

	const label = $derived(
		{ saved: 'Saved', dirty: 'Unsaved changes', saving: 'Saving…', error: 'Not saved' }[status]
	);
</script>

<div class="toolbar">
	<button
		class="btn"
		aria-label="Bold"
		title="Bold, wraps the selection in **"
		onclick={() => applyEdit((d, f, t) => wrap(d, f, t, '**'))}><b>B</b></button>
	<button
		class="btn"
		aria-label="Italic"
		title="Italic, wraps the selection in *"
		onclick={() => applyEdit((d, f, t) => wrap(d, f, t, '*'))}><i>I</i></button>
	<button
		class="btn"
		aria-label="Wikilink"
		title="Wikilink, wraps the selection in [[ ]]"
		onclick={() => applyEdit(asWikilink)}>[[ ]]</button>
	<span class="sep"></span>
	<button
		class="btn"
		aria-label="Make card"
		title="Turn the selection into a Question::Answer card (needs a #flashcards tag)."
		onclick={() => applyEdit(asCard)}><Icon name="sparkles" size={14} /> Make card</button>
	<button
		class="btn"
		aria-label="Make cloze"
		title="Wrap the selection in ==highlight==, read as a cloze deletion"
		onclick={() => applyEdit(asCloze)}><Icon name="sparkles" size={14} /> Make cloze</button>
	<span class="state {status}">{label}</span>
	<button class="btn" onclick={save} disabled={status === 'saving' || status === 'saved'}>Save</button>
</div>

{#if conflict}
	<div class="card conflict">
		<b>This note changed on another device while you were editing.</b>
		<p class="hint">Nothing has been overwritten; choose which version to keep, or copy what you need first.</p>
		<div class="row">
			<button class="btn primary" onclick={keepMine}>Keep mine</button>
			<button class="btn" onclick={takeTheirs}>Take theirs</button>
		</div>
		<details>
			<summary>Their version</summary>
			<pre>{conflict.theirs}</pre>
		</details>
	</div>
{:else if message}
	<p class="msg">{message}</p>
{/if}

<div class="editor" bind:this={host}></div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		padding-bottom: 10px;
		border-bottom: 1px solid var(--line);
		margin-bottom: 12px;
	}
	.toolbar .btn { padding: 4px 9px; }
	.sep { width: 1px; height: 20px; background: var(--line); margin: 0 2px; }
	.state { margin-left: auto; font-size: 12px; color: var(--muted); }
	.state.dirty { color: var(--warn); }
	.state.error { color: var(--bad); }
	.state.saved { color: var(--ok); }

	.conflict { border-color: #fca5a5; background: #fff7f7; margin-bottom: 12px; }
	.conflict .row { display: flex; gap: 8px; margin: 10px 0 0; }
	.conflict pre { max-height: 220px; overflow: auto; background: var(--soft); padding: 10px; border-radius: 8px; font-size: 12px; }
	.msg { color: var(--bad); font-size: 13px; margin: 0 0 10px; }

	.editor :global(.cm-editor) { font-size: 15px; }
	.editor :global(.cm-editor.cm-focused) { outline: none; }
	.editor :global(.cm-content) { font-family: inherit; line-height: 1.62; padding: 4px 0 40vh; }
	.editor :global(.cm-line) { padding: 0; }
	.editor :global(.cm-gutters) { display: none; }

	/* A heading is text. Drawn blue it read as a link, and the note's own title
	   was the worst offender: the first thing on the page looked clickable. Size
	   and weight say "heading"; the accent colour is reserved for links. */
	.editor :global(.cm-h1), .editor :global(.cm-h2), .editor :global(.cm-h3) {
		color: var(--text);
		font-weight: 700;
		text-decoration: none;
	}
	.editor :global(.cm-h1) { font-size: 1.6em; }
	.editor :global(.cm-h2) { font-size: 1.3em; }
	.editor :global(.cm-h3) { font-size: 1.12em; }
	.editor :global(.cm-h4), .editor :global(.cm-h5), .editor :global(.cm-h6) { color: var(--text); font-weight: 600; }
	/* CodeMirror's default highlight style underlines headings, and underline is
	   the one decoration a reader takes to mean "link". The line classes above
	   already carry the hierarchy, so the borrowed rule comes off the spans. */
	.editor :global(.cm-h1 span),
	.editor :global(.cm-h2 span),
	.editor :global(.cm-h3 span),
	.editor :global(.cm-h4 span),
	.editor :global(.cm-h5 span),
	.editor :global(.cm-h6 span) { text-decoration: none; }

	.editor :global(.cm-strong) { font-weight: 700; }
	.editor :global(.cm-emphasis) { font-style: italic; }
	.editor :global(.cm-code) { background: var(--soft); border-radius: 4px; padding: 1px 5px; font: 13px var(--mono); }
	.editor :global(.cm-highlight) { background: #fef08a; border-radius: 3px; padding: 0 2px; }
	.editor :global(.cm-wikilink) { color: var(--accent); text-decoration: underline dotted; cursor: pointer; }
	.editor :global(.cm-task-box) {
		display: inline-block;
		width: 15px;
		height: 15px;
		border: 1.5px solid #9aa0a6;
		border-radius: 3px;
		font-size: 11px;
		line-height: 13px;
		text-align: center;
		vertical-align: -2px;
		margin-right: 6px;
		cursor: pointer;
		color: #fff;
	}
	.editor :global(.cm-task-box.is-checked) { background: var(--accent); border-color: var(--accent); }
</style>
