import { today } from '$server/daily';
import { recordAar } from '$server/tactics/aar';
import { route } from '../../route';

/**
 * Write an after-action review and the draft scenario made from it, `{ game,
 * map, happened, did, should, tags, drill? }`. Answers both paths and the new
 * id, or a refusal naming the field to fix. Never overwrites a note.
 */
export const POST = route(async ({ body, hub }) => recordAar(hub.vault, body, today()));
