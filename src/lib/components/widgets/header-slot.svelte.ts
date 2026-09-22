/**
 * The one control a widget may put in its own frame's heading.
 *
 * `Widget.svelte` draws the heading; a control that belongs to a single
 * widget — the board's "show finished" toggle — is known only inside that
 * widget, so the page above cannot pass it in and the widget below cannot
 * reach up to it. This is the seam between them: the frame offers a slot, the
 * widget fills it, and neither learns anything else about the other.
 */
import { getContext, setContext, type Snippet } from 'svelte';

/** What the frame holds for the widget. One control, or none. */
export type HeaderSlot = { control: Snippet | undefined };

const KEY = Symbol('widget-header');

/** Called by the frame, once, before it renders its heading. */
export function offerHeaderSlot(): HeaderSlot {
	const slot = $state<HeaderSlot>({ control: undefined });
	setContext(KEY, slot);
	return slot;
}

/**
 * Called by a widget, once, during setup: render the snippet `control`
 * returns in the frame's heading, for as long as this widget is on screen.
 * The snippet should render nothing when the widget has nothing to offer, so
 * the claim itself never has to be taken back. It is reached through a
 * function because a widget's snippets are declared in its template, below
 * the script that calls this. Outside a frame this does nothing rather than
 * throwing.
 */
export function claimHeaderSlot(control: () => Snippet): void {
	const slot = getContext<HeaderSlot | undefined>(KEY);
	if (!slot) return;
	$effect(() => {
		slot.control = control();
		return () => (slot.control = undefined);
	});
}
