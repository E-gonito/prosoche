/**
 * Obsidian-style live preview for CodeMirror 6.
 *
 * The rule is the one Obsidian uses: the line the cursor is on shows its raw
 * markdown, every other line shows it rendered. That keeps editing honest, you
 * always see the characters you are about to change, while reading stays clean.
 *
 * Markers are found with line-scoped regexes rather than by walking the syntax
 * tree, because the tree does not know about `[[wikilinks]]` or `==cloze==` and
 * mixing both sources made the code harder to follow than either alone. The
 * syntax tree is still consulted for one thing: whether a position sits inside
 * a fenced code block, where nothing should be hidden.
 */

import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
	WidgetType
} from '@codemirror/view';

/** Emitted when a rendered wikilink is clicked. */
export type WikilinkHandler = (target: string) => void;

const HIDE = Decoration.replace({});

const HEADING = /^(#{1,6})\s+/;
const STRONG = /\*\*([^*\n]+)\*\*|__([^_\n]+)__/g;
const EMPHASIS = /(?<![*\w])\*([^*\n]+)\*(?!\*)|(?<![_\w])_([^_\n]+)_(?!_)/g;
const INLINE_CODE = /`([^`\n]+)`/g;
const HIGHLIGHT = /==([^=\n]+)==/g;
const WIKILINK = /(!?)\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
const CHECKBOX = /^(\s*[-*+]\s+)\[([ xX/\-!])\]\s/;

class CheckboxWidget extends WidgetType {
	constructor(
		private readonly checked: boolean,
		private readonly at: number
	) {
		super();
	}

	eq(other: CheckboxWidget): boolean {
		return other.checked === this.checked && other.at === this.at;
	}

	toDOM(view: EditorView): HTMLElement {
		const box = document.createElement('span');
		box.className = `cm-task-box${this.checked ? ' is-checked' : ''}`;
		box.setAttribute('role', 'checkbox');
		box.setAttribute('aria-checked', String(this.checked));
		box.textContent = this.checked ? '✓' : '';
		box.onmousedown = (event) => {
			event.preventDefault();
			view.dispatch({ changes: { from: this.at, to: this.at + 1, insert: this.checked ? ' ' : 'x' } });
		};
		return box;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

class LinkWidget extends WidgetType {
	constructor(
		private readonly label: string,
		private readonly target: string,
		private readonly onClick: WikilinkHandler | undefined
	) {
		super();
	}

	eq(other: LinkWidget): boolean {
		return other.label === this.label && other.target === this.target;
	}

	toDOM(): HTMLElement {
		const link = document.createElement('span');
		link.className = 'cm-wikilink';
		link.textContent = this.label;
		link.title = this.target;
		link.onmousedown = (event) => {
			event.preventDefault();
			this.onClick?.(this.target);
		};
		return link;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

function buildDecorations(view: EditorView, onLinkClick?: WikilinkHandler): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();

	// Raw markdown is shown on the line being edited, which means only while
	// the editor has focus. An unfocused note reads as fully rendered, the way
	// it does in Obsidian, rather than leaking a stray `#` on whichever line
	// the cursor happens to rest at.
	const cursorLines = new Set(
		view.hasFocus
			? view.state.selection.ranges.flatMap((range) => {
					const from = view.state.doc.lineAt(range.from).number;
					const to = view.state.doc.lineAt(range.to).number;
					return Array.from({ length: to - from + 1 }, (_, i) => from + i);
				})
			: []
	);

	const tree = syntaxTree(view.state);
	const inCode = (pos: number): boolean => {
		let node = tree.resolveInner(pos, 1);
		while (node.parent) {
			if (/FencedCode|CodeBlock/.test(node.name)) return true;
			node = node.parent;
		}
		return false;
	};

	for (const { from: visibleFrom, to: visibleTo } of view.visibleRanges) {
		let pos = visibleFrom;
		while (pos <= visibleTo) {
			const line = view.state.doc.lineAt(pos);
			pos = line.to + 1;
			if (inCode(line.from)) continue;

			const text = line.text;
			const heading = HEADING.exec(text);
			if (heading) {
				builder.add(line.from, line.from, Decoration.line({ class: `cm-h${heading[1].length}` }));
			}

			// The cursor's own line keeps every character visible.
			if (cursorLines.has(line.number)) continue;

			const marks: Array<{ from: number; to: number; deco: Decoration }> = [];
			const push = (from: number, to: number, deco: Decoration) => marks.push({ from, to, deco });

			if (heading) push(line.from, line.from + heading[0].length, HIDE);

			const checkbox = CHECKBOX.exec(text);
			if (checkbox) {
				const boxAt = line.from + checkbox[1].length;
				const checked = /[xX]/.test(checkbox[2]);
				push(boxAt, boxAt + 3, Decoration.replace({ widget: new CheckboxWidget(checked, boxAt + 1) }));
			}

			for (const [regex, cls] of [
				[STRONG, 'cm-strong'],
				[EMPHASIS, 'cm-emphasis'],
				[HIGHLIGHT, 'cm-highlight'],
				[INLINE_CODE, 'cm-code']
			] as const) {
				regex.lastIndex = 0;
				for (let m = regex.exec(text); m; m = regex.exec(text)) {
					const inner = m[1] ?? m[2] ?? '';
					const openLength = m[0].indexOf(inner);
					if (openLength <= 0) continue;
					const closeLength = m[0].length - inner.length - openLength;
					const at = line.from + m.index;
					push(at, at + openLength, HIDE);
					push(at + openLength, at + openLength + inner.length, Decoration.mark({ class: cls }));
					push(at + m[0].length - closeLength, at + m[0].length, HIDE);
				}
			}

			WIKILINK.lastIndex = 0;
			for (let m = WIKILINK.exec(text); m; m = WIKILINK.exec(text)) {
				const [whole, embed, target, section, alias] = m;
				const label = alias ?? (section ? `${target} › ${section}` : target);
				const at = line.from + m.index;
				push(
					at,
					at + whole.length,
					Decoration.replace({
						widget: new LinkWidget(embed ? `📎 ${label}` : label, target.trim(), onLinkClick)
					})
				);
			}

			marks.sort((a, b) => a.from - b.from || a.to - b.to);
			let lastTo = -1;
			for (const mark of marks) {
				// Overlapping markers (bold inside a link, say) would throw; the
				// outermost match wins and the rest are skipped.
				if (mark.from < lastTo) continue;
				builder.add(mark.from, mark.to, mark.deco);
				if (mark.deco !== HIDE) continue;
				lastTo = mark.to;
			}
		}
	}

	return builder.finish();
}

/**
 * The live-preview extension. `onLinkClick` receives a clicked wikilink
 * target, so navigation stays the caller's decision.
 *
 * Returns the plugin together with an `atomicRanges` facet built from the same
 * instance, so the cursor steps over a hidden marker in one press instead of
 * landing inside text the user cannot see.
 */
export function livePreview(onLinkClick?: WikilinkHandler): Extension {
	const plugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view, onLinkClick);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
					this.decorations = buildDecorations(update.view, onLinkClick);
				}
			}
		},
		{ decorations: (value) => value.decorations }
	);

	return [
		plugin,
		EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none)
	];
}
