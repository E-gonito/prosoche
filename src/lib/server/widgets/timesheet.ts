/**
 * The `timesheet` widget: today's section of the work timesheet, read only.
 *
 * The parsing is in `$server/timesheet`; what this decides is *whose*
 * timesheet a tab is looking at. A workspace that declares folders is asked
 * about its own folders, so the widget placed on another workspace cannot
 * quietly show the atlas one; a tab with no workspace falls back to the
 * configured folder.
 *
 * Writes nothing. The timesheet is a document the user shares at work and the
 * hub only ever reads it.
 */

import { timesheetFor, type TimesheetView } from '../timesheet';
import type { WidgetContext } from '../widgets';

export async function load(ctx: WidgetContext): Promise<TimesheetView> {
	return timesheetFor(ctx.vault, ctx.today, ctx.workspace?.folders);
}
