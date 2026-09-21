/**
 * The daily habits and how the streaks are going.
 *
 * The list comes from the daily-note template rather than from `🔁` recurring
 * tasks, because this vault has no `🔁` anywhere and does have a template of
 * eighteen tasks copied into every day. `study/habits.ts` explains the
 * reasoning and honours `🔁` as well, for when the user adopts it.
 *
 * Not scoped by workspace: habits live in the journal, wherever the widget is
 * placed. A workspace tab showing them shows the same ones, which is what the
 * user asked for when they put this widget on the Personal dashboard.
 */

import { habits } from '$server/study/habits';
import type { WidgetContext } from '../widgets';

/** Today's state for each habit, plus a month of history. Reads only. */
export async function load(ctx: WidgetContext): Promise<unknown> {
	const all = await habits(ctx.vault, ctx.index, { today: ctx.today });
	const active = all.filter((h) => h.today !== null);
	return {
		today: ctx.today,
		habits: all,
		doneToday: active.filter((h) => h.today).length,
		ofToday: active.length
	};
}
