/**
 * Fixtures for phase 3: a workspace whose work lives in its deck note.
 *
 * `_hub/workspaces/work.md` declares no `deck:`, so the deck defaults to
 * `Work/Tasks.md`. Nothing on these lines carries a quadrant, a due date, an
 * id or the workspace tag — the shape the author's own project notes have —
 * so before the deck rule the Work board was empty and Today knew nothing
 * about the workspace at all.
 *
 * Deliberately all open: `17-board-layout.spec.ts` parks Work's two empty
 * finished columns, and a ticked line here would fill one of them.
 */

export default async function () {
	return {
		'Work/Tasks.md': ['# Work tasks', '', '- [ ] Sign the new supplier contract', '- [ ] Book the site visit', ''].join(
			'\n'
		)
	};
}
