/**
 * Fixtures for phase 4: the AI surfaces, with the layer switched off.
 *
 * `_hub/ai.md` sets `enabled: false`, which is guardrail G10 and is also the
 * default for a vault that has no such file. That is the point of this
 * fixture: the suite runs with no `claude` binary and no budget, so every AI
 * surface has to be reachable, render, and say plainly why it is doing
 * nothing — which is exactly the state a new install is in. A suite that
 * could only test the happy path would be testing a machine nobody has.
 *
 * The file is written rather than omitted so the state is explicit in the
 * fixture, and so a future change to the default cannot quietly turn the
 * suite into a different test.
 *
 * Also here: a capture note with the two shapes quick capture writes, so the
 * inbox widget has lines as well as notes; a study note for the suggest-cards
 * button to point at; and a workspace carrying the insights widget.
 */

export default async function () {
	return {
		'_hub/ai.md': [
			'---',
			'enabled: false',
			'budget:',
			'  dailyUsd: 2',
			'  maxConcurrent: 1',
			'  maxTimeoutSeconds: 300',
			'---',
			'',
			'# AI settings',
			'',
			'The end-to-end suite runs with the layer off. Every surface must still load.',
			''
		].join('\n'),

		'Inbox/Capture.md': [
			'# Capture',
			'',
			// A past day on purpose: quick capture writes under a heading for
			// *today*, and a test asserting what it wrote needs that heading to
			// be the one capture creates, not one this fixture left lying there.
			'## 2026-09-15',
			'- 09:12 Ask whether the parser handles tab indents',
			'- [ ] 09:20 Chase the sign-off on the spec',
			'- [x] 09:30 Already dealt with',
			''
		].join('\n'),

		'Reference/Handshakes.md': [
			'---',
			'tags: [reference]',
			'---',
			'',
			'# Handshakes',
			'',
			'The three-way handshake is SYN, SYN-ACK, ACK.',
			'A socket is identified by the four-tuple of source and destination address and port.',
			''
		].join('\n'),

		'_hub/workspaces/thinking.md': [
			'---',
			'name: Thinking',
			'color: "#0d9488"',
			'tag: ws/thinking',
			'template: project',
			'folders: [Reference]',
			'tabs:',
			'  - title: Ask',
			'    widgets: [insights, inbox]',
			'---',
			'',
			'Where the phase 4 widgets live in the test vault.',
			''
		].join('\n')
	};
}
