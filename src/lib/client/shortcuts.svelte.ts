/**
 * Every global key binding in the app, in one list with one listener.
 *
 * There is a single registrant: the command palette installs its commands
 * once, from the shell, and no other component attaches a `window` keydown
 * handler. That buys what a scattering of handlers cannot: the bindings can be
 * listed (the palette shows them, so they are discoverable rather than
 * folklore), two of them cannot silently shadow each other, and the rule
 * about typing is enforced in exactly one place.
 *
 * **A shortcut never fires while the user is typing.** A key pressed inside an
 * input, a textarea, a select or the editor belongs to the text, not to the
 * app. Only a chorded binding — `mod+k` and friends — may opt in with
 * `whileTyping`, because it cannot be part of what someone is writing.
 */

/** A binding. `keys` is `mod+k`, `t`, `?`: `mod` is ⌘ on a Mac, Ctrl elsewhere. */
export interface Shortcut {
	keys: string;
	/** What it does, in the palette's words. */
	description: string;
	run: () => void;
	/** Fires even when the caret is in a text box. Chorded keys only. */
	whileTyping?: boolean;
}

/**
 * The installed bindings. `$state.raw` because they are only ever replaced
 * whole: a deep `$state` array would hand out proxies, and an effect that
 * both read and wrote it would loop.
 */
let bindings = $state.raw<Shortcut[]>([]);

/**
 * Install the app's bindings, replacing any earlier set, and start handling
 * keys. Returns the function that stops and clears them. Keys are lower-cased
 * and an unrecognised binding simply never matches; when two share keys the
 * first in the list wins. Off the browser there is no window to listen on, so
 * only the list is kept.
 */
export function install(shortcuts: Shortcut[]): () => void {
	bindings = shortcuts.map((shortcut) => ({ ...shortcut, keys: normalise(shortcut.keys) }));
	if (typeof window === 'undefined') return () => (bindings = []);
	window.addEventListener('keydown', handle);
	return () => {
		window.removeEventListener('keydown', handle);
		bindings = [];
	};
}

/**
 * Every installed binding, in the order given, for the palette to list.
 * Reactive: a component that reads it re-renders when the set changes.
 */
export function all(): Shortcut[] {
	return bindings;
}

/**
 * How a binding should be drawn: `⌘K` on a Mac, `Ctrl K` elsewhere, and the
 * bare key otherwise. Returns an empty string for a command with no binding,
 * so a caller can render it without a branch.
 */
export function keyLabel(keys: string): string {
	if (!keys.trim()) return '';
	const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
	return normalise(keys)
		.split('+')
		.map((part) => {
			if (part === 'mod') return mac ? '⌘' : 'Ctrl';
			if (part === 'shift') return mac ? '⇧' : 'Shift';
			if (part === 'alt') return mac ? '⌥' : 'Alt';
			if (part === 'escape') return 'Esc';
			return part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1);
		})
		.join(mac ? '' : ' ');
}

/**
 * True when this element is somewhere the user could be typing: a form field,
 * anything contenteditable, or inside CodeMirror.
 */
function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
	if (target.isContentEditable) return true;
	return Boolean(target.closest('.cm-editor'));
}

function handle(event: KeyboardEvent): void {
	if (event.isComposing || event.repeat) return;
	if (press(describe(event), isTyping(event.target))) event.preventDefault();
}

/**
 * Run the binding for a pressed combination, in the spelling `describe`
 * gives. `typing` says the caret is in a text box, which only a
 * `whileTyping` binding may answer. Returns whether one ran, so the caller
 * knows to swallow the key. Exported for the table test: it is the rule.
 */
export function press(pressed: string, typing: boolean): boolean {
	const shortcut = bindings.find((s) => s.keys === pressed);
	if (!shortcut || (typing && !shortcut.whileTyping)) return false;
	shortcut.run();
	return true;
}

/** The pressed combination in the same spelling as a registered binding. */
function describe(event: KeyboardEvent): string {
	const parts: string[] = [];
	if (event.metaKey || event.ctrlKey) parts.push('mod');
	if (event.altKey) parts.push('alt');
	const key = event.key.toLowerCase();
	// Shift is only named when it did not already change the character, so `?`
	// is `?` rather than `shift+/` on every keyboard layout.
	if (event.shiftKey && key.length > 1) parts.push('shift');
	parts.push(key);
	return parts.join('+');
}

function normalise(keys: string): string {
	return keys
		.toLowerCase()
		.split('+')
		.map((part) => part.trim())
		.filter(Boolean)
		.join('+');
}
