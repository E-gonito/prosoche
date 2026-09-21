/**
 * Every global key binding in the app, in one registry with one listener.
 *
 * No component attaches its own `window` keydown handler. They register a
 * shortcut here instead, which buys three things a scattering of handlers
 * cannot: the bindings can be listed (the palette shows them, so they are
 * discoverable rather than folklore), they cannot silently shadow each other,
 * and the rule about typing is enforced in exactly one place.
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
	/** Heading it appears under in the palette. */
	group: string;
	run: () => void;
	/** Fires even when the caret is in a text box. Chorded keys only. */
	whileTyping?: boolean;
}

/**
 * The bindings, held twice: once for identity and once for reactivity.
 *
 * Two bugs came from making the array itself `$state`, and both are worth
 * naming because the shape of the fix follows from them.
 *
 * A `$state` array is a proxy, so `registry.push(x)` stores a proxy of `x`
 * while the caller still holds the raw `x`. `indexOf` then never matches and
 * unregistering silently did nothing, so every navigation left its bindings
 * behind for ever.
 *
 * Worse, pushing to a `$state` array both reads and writes it. `register` is
 * called from an `$effect`, so the effect depended on the thing it wrote and
 * re-ran until Svelte gave up — `effect_update_depth_exceeded`, which locks
 * the page after it has painted, so the app looked fine and did not work.
 *
 * So there are two: a plain array that is the source of truth and keeps the
 * objects' identity, and a `$state` snapshot that register and unregister
 * *replace* when it changes. Readers read the snapshot and are reactive.
 * Writers only assign to it, never read it, so an `$effect` that registers
 * has no dependencies and runs exactly once.
 */
const registry: Shortcut[] = [];
let snapshot = $state<Shortcut[]>([]);
let listeners = 0;
let attached: ((event: KeyboardEvent) => void) | null = null;

/**
 * Add bindings and return the function that removes exactly those again.
 *
 * Registering the same keys twice is allowed and the later one wins, so a
 * page may override a global binding while it is mounted; the override goes
 * away when its unregister runs. Never validates the key string beyond
 * lower-casing it, because an unrecognised binding simply never matches.
 */
export function register(shortcuts: Shortcut[]): () => void {
	const added = shortcuts.map((shortcut) => ({ ...shortcut, keys: normalise(shortcut.keys) }));
	registry.push(...added);
	snapshot = [...registry];
	return () => {
		for (const shortcut of added) {
			const at = registry.indexOf(shortcut);
			if (at >= 0) registry.splice(at, 1);
		}
		snapshot = [...registry];
	};
}

/**
 * Every registered binding, in the order they were registered, for the palette
 * to list: the global commands first, then whatever the current page added.
 * Reactive, so a component that reads it re-renders when a page registers its
 * own. A later binding still wins when the key is actually pressed.
 */
export function all(): Shortcut[] {
	return snapshot;
}

/**
 * Start handling keys, and return the function that stops. Safe to call from
 * several components: the window listener is attached once and removed when
 * the last caller lets go. Does nothing at all on the server.
 */
export function listen(): () => void {
	if (typeof window === 'undefined') return () => {};
	if (++listeners === 1) {
		attached = handle;
		window.addEventListener('keydown', attached);
	}
	return () => {
		if (--listeners === 0 && attached) {
			window.removeEventListener('keydown', attached);
			attached = null;
		}
	};
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
 * anything contenteditable, or inside CodeMirror. Exported because the palette
 * needs the same answer when it decides whether to take focus.
 */
export function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
	if (target.isContentEditable) return true;
	return Boolean(target.closest('.cm-editor'));
}

function handle(event: KeyboardEvent): void {
	if (event.isComposing || event.repeat) return;
	const pressed = describe(event);
	const typing = isTyping(event.target);
	// Last registered wins, so a page can override a global binding.
	for (let i = registry.length - 1; i >= 0; i--) {
		const shortcut = registry[i];
		if (shortcut.keys !== pressed) continue;
		if (typing && !shortcut.whileTyping) return;
		event.preventDefault();
		shortcut.run();
		return;
	}
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
