/**
 * A workspace with real content in every corner the Workspaces module reads:
 * a board in the Obsidian Kanban plugin's own format, with a card carrying
 * notes, a due date, a priority and a label, and a custom HTML page so the
 * sandboxed-iframe tab has something to embed.
 *
 * Overview.md, Inbox and Log start empty on purpose: the suite creates them
 * by using the app, which is the behaviour worth proving.
 */
export default () => ({
	'Work/Board.md': [
		'---',
		'',
		'kanban-plugin: board',
		'',
		'---',
		'',
		'## To do',
		'',
		'- [ ] Draft the proposal @{2000-01-01} `Q2` #client',
		'\tAsk for the budget first.',
		'- [ ] Book the venue',
		'',
		'',
		'## Doing',
		'',
		'',
		'',
		'## Done',
		'',
		'- [x] Sign the contract',
		'',
		'',
		'',
		'',
		'%% kanban:settings',
		'```',
		'{"kanban-plugin":"board"}',
		'```',
		'%%'
	].join('\n'),
	'Work/Pages/Eye.html': '<!doctype html>\n<html>\n<head><meta charset="utf-8"><title>Eye</title></head>\n<body><p id="marker">Eye 3D page</p></body>\n</html>\n'
});
