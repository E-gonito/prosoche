/**
 * Saying a word aloud with the voice the browser already has.
 *
 * Voices belong to the device: a Mac or phone may have a Filipino one and
 * another may not, and a browser loads its list late. `voiceFor` therefore
 * answers whether one exists now and again when the list arrives, so a button
 * can hide on a device that cannot speak the language and appear on one that
 * can. Nothing here needs a network, a key or a file.
 */

import { pickVoice } from '$lib/shared/pronounce';

/** Run `onChange` with the voice for `code` (or undefined) now and whenever the device's voices change. Returns how to stop. Does nothing without speech support. */
export function watchVoice(code: string, onChange: (voice: SpeechSynthesisVoice | undefined) => void): () => void {
	if (typeof speechSynthesis === 'undefined') return () => {};
	const update = () => onChange(pickVoice(speechSynthesis.getVoices(), code));
	update();
	speechSynthesis.addEventListener('voiceschanged', update);
	return () => speechSynthesis.removeEventListener('voiceschanged', update);
}

/** Say `text` in `voice`, replacing anything still being said. Must come from a click. */
export function speak(text: string, voice: SpeechSynthesisVoice): void {
	speechSynthesis.cancel();
	const say = new SpeechSynthesisUtterance(text);
	say.voice = voice;
	say.lang = voice.lang;
	say.rate = 0.85;
	speechSynthesis.speak(say);
}
