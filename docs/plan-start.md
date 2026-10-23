# Plan: Getting started on a block

Written 2026-10-23, after a conversation with the author. Built the same day,
with these differences from what follows:

- "Quiet today" (decision 7) and the 20-minute minimum (decision 4) were
  turned down by the author before building.
- Nudges are Web Push, not ntfy, because the app can be opened over HTTPS.
- Settings live in `_hub/focus.md`: `warmup_minutes`, `wind_down_minutes`,
  `follow_up_minutes`, `plan_by`.
- `hasPlan` counts any timed block, ticked or not, so a finished morning does
  not get "Today has no plan yet".
**default** marks a choice the author was not asked about; **open** marks one
that is theirs to make before the step that needs it.

## Why

The author plans the day and then does not start it. Two separate things go
wrong:

1. **Forgetting.** Today is not open, so a block's start time passes unseen
   and the afternoon goes to a game. Nothing outside the app says "now".
2. **Friction.** When the author does look, starting a block such as
   "Work on eye2gene, 10:00 - 18:00" feels like committing to eight hours,
   so it gets put off. Once started, the author keeps going without help.

The vault shows the result. On 21 October, 2 of 15 blocks were ticked. The
day's blocks overlap: `10:00 - 18:00 Work on eye2gene` contains two shorter
blocks, two blocks start at 18:00, and the order in the file is the
template's, not the clock's.

A timer the author must remember to open fixes neither problem. So this plan
has two parts. A **nudge** reaches the author outside the app, a little before
a block, and starting a block commits to only **five minutes**.

The study focus view (`docs/plan-study-focus.md`) already has most of the
machinery: a running session in `_hub/.state/`, a countdown, +15 min, and
three outcomes logged as a sub-bullet under the block. This plan widens it
from study blocks to every block. It does not add a second timer.

## Decisions

1. **One running session, for any block.** `server/study/session.ts` becomes
   `server/focus/session.ts`. A session belongs to a daily-note block. A study
   block also carries its subject's step and `first::` line, as it does now.
   Only one session runs at a time, as before. Starting a second one answers
   `busy` and names the running one.
2. **Start commits to five minutes, not the block.** The focus view opens on
   a 5:00 countdown labelled "Just five minutes". At zero it plays one soft
   chime, if the tab is open, and the clock becomes the block's time left. It
   does not ask whether to keep going: a question at minute five gives the
   author a way out. End is always on screen (**default**: 5 minutes,
   changeable in Settings).
3. **A now strip on every page.** The shell shows one line at the top of the
   rail on a desktop, and under the header on a phone. It is in one of four
   states:
   - **Running:** `● Fullstack · 23:41 left`, which opens the focus view.
   - **Due:** `Fullstack started 4 min ago · Start`. Shown from a block's
     start until 30 minutes after it.
   - **Soon:** `Fullstack in 8:12`. Shown from 15 minutes before a block.
   - **Nothing:** no strip at all. A quiet day shows no strip.
   The tab's title follows the strip (`▶ 23:41` or `Due: Fullstack`), so a
   tab left behind other tabs still shows it.
4. **Which blocks count.** Every open, timed block outside a code fence,
   however short. The template's 10-minute habits count too, because the
   author asked for them (a 20-minute minimum was proposed and turned down).
   When blocks overlap, the strip shows the one that started most
   recently. A long block such as eye2gene steps aside for a shorter one
   inside it while that one runs. Blocks that start at the same minute
   share one strip and one nudge: `18:00 · Shop, Clinic`. Start then asks
   which.
5. **Three nudges per block, then silence.**
   - **T−10, wind down:** "Fullstack at 17:00. Finish this match." A game
     cannot be dropped at the second the block starts, so warning ten
     minutes early is what makes T−0 doable.
   - **T−0, start:** "Fullstack now. Just five minutes."
   - **T+10, once:** "Fullstack hasn't started. Start, or let it go."
   - None of them is sent once the block has a session, is ticked, or is
     skipped. Tapping a nudge opens `/focus/start?block=<line>&day=<day>`,
     which shows the block and one Start button.
   - There is no fourth nudge and no running count of missed blocks. The aim
     is a start, not guilt (**default**: lead times 10 and 10 minutes,
     changeable).
6. **When the day has no plan.** The Journal template's "Set out tasks for
   the day" block is a block like any other, so it gets nudged too. When
   today's note does not exist or has no timed open block by 10:00, one push
   says "Today has no plan yet." (**default**: 10:00).
7. **There is no way to mute a day.** "Quiet today" was proposed and turned
   down by the author: an off switch is the easy way out at T−10. What has
   been sent is recorded in `_hub/.state/nudges.json`, so a restart never
   sends a nudge twice. The file is transient, as `.state/` already is.
8. **Nudges go out through one module, `server/notify.ts`, as Web Push.**
   The app is opened at its HTTPS address (decision 11). The phone (Android,
   Chrome) and the Mac each allow notifications once, and the browser hands
   prosoche a subscription. The server sends to each subscription with a
   VAPID key, using the `web-push` package.
   - Subscriptions are kept in `_hub/.state/push.json`, which is transient.
     A device that is not subscribed gets nothing, and Settings lists the
     devices that are.
   - A small service worker, `src/service-worker.ts`, shows the push and
     opens its link when tapped. It caches nothing.
   - The words of a push are encrypted from the server to the device
     (RFC 8291). Google's push service carries the message but cannot read
     it. So the words go in the push, and no third party can read them.
   - The VAPID private key is config (`HUB_VAPID_PRIVATE`), and is never
     committed.
   - Unset config means nudges are off. Settings shows that in words, and the
     server logs it once at boot. It is never silently off.
   - A push that fails is logged and not retried. A late nudge is worse than
     a missing one.
9. **Ending is the study ending, for every block.** The outcomes are Done,
   Made progress and Didn't get to it, with the same ticks and the same one
   sub-bullet. A non-study block's sub-bullet is
   `- Focus: <block text>, 25m, progress`, so `loggedSessions` reads it with
   no change to its grammar. Study's weekly count keeps counting only its
   subjects.
10. **The server's clock and timezone decide what "17:00" means.** The block
    times in the note are local. The container's timezone must be the
    author's. It was checked on 2026-10-23 and is `Europe/London`. A test
    pins the BST to GMT change on 25 October, so a block doesn't move an
    hour that night.
11. **The app is opened at its Tailscale Serve HTTPS address.**
    Push and service workers need a secure origin, and
    `http://100.104.242.57:3100` is not one. Tailscale Serve already proxies
    HTTPS to port 3100 on the container, with a certificate for that name
    (checked 2026-10-23). MagicDNS is on for the tailnet, so each device needs
    only "Use Tailscale DNS" turned on to resolve the name. The plain HTTP
    address keeps working, but it gets no push.
    - Saved settings such as the theme are kept per address, so they reset
      once when you switch.
    - No form posts or uploads use `multipart`, so SvelteKit's origin check
      does not need `ORIGIN` to be set. Step 5 checks this again.

## Design it twice: where the session lives

- **A.** Keep `study/session.ts` and add a separate `focus/timer.ts` for
  other blocks. That means two state files, two "busy" rules, and two places
  that know the sub-bullet. The strip would also need to ask both.
- **B, picked.** One `focus/session.ts`, with a block and an optional study
  step. Study calls it with its subject's step. There is one state file, one
  busy rule, and one place that writes the outcome. Study's existing tests
  must pass unchanged, which is how we know the move broke nothing. The old
  `study-session.json` is read once and moved, so a running study session
  survives the deploy.

## Screens

The strip, desktop rail (phone: the same line under the header):

```
  prosoche
  [ Search or jump ]
  ┌──────────────────────────────────┐
  │ Fullstack started 4 min ago      │
  │                      [ Start ]   │
  └──────────────────────────────────┘
  Today
  ...
```

`/focus`, after Start:

```
  Learn Frontend (React.dev) · 17:00 - 17:30

        Just five minutes
             4:12

  Start with: <first:: line, study blocks only>

  [ scratch box ]

  [ +15 min ]
  How did it go?  [ Done ] [ Made progress ] [ Didn't get to it ]
```

After minute five the label goes and the clock shows the block's time left.
`/study/<subject>/session` stays as a link that sends you to `/focus`.

On **Today**, each open timed block on the timeline and in the list gets a
Start icon. It does the same as Start on the strip.

## Build order

1. **Check the clock.** Confirm the container's timezone. Write a pure
   `dueBlocks(content, nowMin, rules)` that returns each counted block's
   state (soon, due or past) and which nudges it is owed. Table-test it
   against a copy of the 21 October note: the overlaps, the same-start pair,
   the 10-minute habits, and the fenced Backlog.
2. **Move the session.** Move `study/session.ts` to `focus/session.ts`, with
   the block as the core and the step optional. All of study's session tests
   pass untouched. Migrate the state file.
3. **The focus view and its API.** `/focus`, `/focus/start`, and
   `/api/focus` (start, extend, end). Add the five-minute warm-up, the chime,
   and the title.
4. **The strip.** The root layout loader returns `now`: the running session,
   or the block from `dueBlocks`, plus the server's clock for skew. The client
   ticks every second and reloads `now` each minute and after any task edit.
   Add the Start icons on Today.
5. **Nudges.** Build:
   - The VAPID keys, the service worker and `notify.ts`.
   - A subscribe button in Settings that lists the subscribed devices.
   - A 30-second loop started by `hub()`, beside git sync.
   - `nudges.json`, and the no-plan push.
   - Settings for the lead times and the warm-up length.

   Test with a fake clock and a fake push sender. Nothing in a test calls the
   network. Then send one real push from the container to the phone, to show
   that outbound HTTPS to `fcm.googleapis.com` gets past pfSense.
6. **e2e.** A block goes from soon to due on the strip. Start it, pass the
   warm-up, and end it with each outcome. Check the daily note's bytes, and
   check that `vault-conformance.test.ts` still passes.

Steps 1 to 4 fix the friction and are useful on their own. Step 5 fixes the
forgetting, and needs each device to be using the HTTPS address first.

## If Web Push turns out unreliable

The fallback is ntfy, self-hosted in its own container and reached over
Tailscale. The words would stay on the network, and its Android app gets the
push without going through Google. Only `notify.ts` changes. Nothing else
knows how a push is sent. This is worth doing only if Chrome on the phone
drops or delays pushes in practice. One example is Android battery saving
holding back a T−10 nudge until after the block has started.

## Not now

- Blocking games or apps at block time, for example from the gaming machine
  or the router. This is stronger than a nudge, but it is a different tool and
  much more intrusive.
- Streaks, missed-block counts, and anything red.
- Planned versus actual time per workspace (the phase 3 time log). The
  sub-bullets record the minutes, so it can be added later from them.
- AI suggestions for the first five minutes of a non-study block. The author
  can write a `first::` sub-bullet under a block by hand, and it would be
  shown. Reading that is a small step after step 3 (**default**: not in the
  first build).
- This reverses one line in `plan-study-focus.md`'s "Not now",
  "notifications are out". The reason is the 21 October note: planning
  without a nudge has not been enough.
