/**
 * A workspace with real content in every corner the Workspaces module reads:
 * a card in its own Tasks.md (via the deck rule, no tag needed), and a custom
 * HTML page so the sandboxed-iframe tab has something to embed.
 *
 * Inbox and Log start empty on purpose: the suite creates them by
 * using the app, which is the behaviour worth proving.
 */
export default () => ({
	'Work/Tasks.md': '# Tasks\n- [ ] Draft the proposal `Q2`\n',
	'Work/Pages/Eye.html': '<!doctype html>\n<html>\n<head><meta charset="utf-8"><title>Eye</title></head>\n<body><p id="marker">Eye 3D page</p></body>\n</html>\n'
});
