# Where prosoche runs

The one live copy is the Proxmox container **LXC 108 `prosoche`** on the host
`pve`. Open it at **http://100.104.242.57:3100**. This repository is developed
on a different machine, the VM `dev` (VM 107, `100.106.156.121`), and nothing
there is meant to serve the app any more.

| | |
|---|---|
| Machine | LXC 108 `prosoche` on `pve`, Ubuntu 24.04, 1.5 GB RAM, 7.8 GB disk |
| Addresses | Tailscale `100.104.242.57`, LAN `10.0.0.11` |
| Service | `prosoche.service` (system unit), runs as user `app` |
| Code | `/srv/prosoche/repo`, a clone of `E-gonito/prosoche` |
| Vault | `/srv/vault`, a clone of `E-gonito/obsideon-notes` |
| Index | `/var/lib/prosoche/index.db`, safe to delete |
| Deploy | `prosoche-deploy.timer` runs `/usr/local/bin/prosoche-deploy` every 2 minutes |
| Deploy log | `/var/log/prosoche-deploy.log` |

The unit sets `PORT=3100`, `HOST=0.0.0.0`, `HUB_VAULT=/srv/vault` and
`HUB_DB=/var/lib/prosoche/index.db`, and a drop-in adds `HUB_CLAUDE_BIN`
(see The AI features).

## Deploying

**A push to `main` on GitHub is a deploy.** Within about two minutes the timer
does the following:

1. Fetches `origin/main`, and stops there if nothing moved.
2. Resets the checkout to it, then runs `npm ci` and `npm run build` as `app`.
3. Restarts the service and checks that `http://127.0.0.1:3100/` answers.
4. If the build or the check fails, puts the previous `build/` and commit back
   and restarts again. Every step is logged to the deploy log.

So nothing half-finished goes to `main`. Run `npm test`, `npm run check` and
the e2e suite on the merge commit before pushing (see `CLAUDE.md`).

To deploy at once, or to rebuild the same commit:

```bash
ssh root@100.104.242.57 systemctl start prosoche-deploy          # only if main moved
ssh root@100.104.242.57 /usr/local/bin/prosoche-deploy --force   # rebuild regardless
```

## The vault

`/srv/vault` syncs through git alone. The user `app` pushes over SSH on port
443 using the host alias `github-vault` (key `~/.ssh/id_ed25519_vault`).
prosoche commits a minute after a save and pushes. Obsidian on the Mac commits
five minutes after the last edit and pulls every minute.

**`Private/` is not in git.** The vault's `.gitignore` lists it, so the Date
module's data (`Private/Dating/Ledger.md` and `Private/Dating/People/`) exists
only in this container. Unless Proxmox backs up LXC 108, nothing else holds a copy. Moving
the app to another machine means copying `Private/` over by hand, as `app`.

## The AI features

Claude Code is installed for the user `app` at `/home/app/.local/bin/claude`
and signed in with the owner's claude.ai account. The drop-in
`/etc/systemd/system/prosoche.service.d/claude.conf` sets
`HUB_CLAUDE_BIN=/home/app/.local/bin/claude`. That turns on the morning
briefing, glossary look-up and scan, the Sync commit-message suggestion and
Date insights.

If the sign-in lapses, sign in again from the Proxmox host: run
`pct enter 108`, then `su - app`, then `claude`, then `/login`. Check it with
`runuser -u app -- /home/app/.local/bin/claude auth status`. When the CLI is
missing, the features say so and name `HUB_CLAUDE_BIN`.

## Reaching it from `dev`

A Tailscale grant lets `100.106.156.121` reach `100.104.242.57` on port 22 and
nothing else. `dev`'s key is in `/root/.ssh/authorized_keys`, so from `dev`
use `ssh root@100.104.242.57`. Port 3100 is not open to `dev`, so run page
checks inside the container:

```bash
ssh root@100.104.242.57 'git -C /srv/prosoche/repo log -1 --oneline; tail -3 /var/log/prosoche-deploy.log'
ssh root@100.104.242.57 'journalctl -u prosoche -n 50 --no-pager'
ssh root@100.104.242.57 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/today'
```

Write to `/srv/vault` only through the app. Any other write also has to be
committed as `app`, or the next sync picks it up under the wrong name.

## Audit, 2026-09-30

A read-only check of the live container after deploying `29f20c5`:

- **Pages:** a crawl of every page reachable from the nav found 268. All
  returned 200, and the slowest took 0.15 s (`/glossary/computer-science`).
  No API route was called.
- **Deploys:** `29f20c5` deployed cleanly at 23:21. Restarts earlier that day,
  from 11:44 to 12:04, hung until systemd killed them after 90 s. The
  "stop in a moment" fix (`a4fb1a7`) is live, and the 23:21 restart was clean.
- **Resources:** the disk is 31% used and about 1.3 GB of memory is free, so
  `npm ci` and a build fit.
- **Sync:** the vault was level with `origin/master`.

Open points:

- **There is no login, and `HOST=0.0.0.0` also serves the LAN** at
  `10.0.0.11:3100`, where anyone on that network can open Date. Setting
  `HOST=100.104.242.57` limits it to the tailnet.
- **`Private/` has no copy outside the container** (see above). Check that
  LXC 108 is in a Proxmox backup job.
- **The AI features were off**, because the Claude CLI was not installed. It
  was installed and signed in on 2026-10-01 (see above).
- **The retired copy on `dev`**, the user unit `prosoche.service` on
  `100.106.156.121:3100`, was stopped and disabled the same day, after
  `Private/` was copied into the container. Do not start it again. Two
  running copies both commit to the same vault repository.
