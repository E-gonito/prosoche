# Plan: a Cute tab for filing images by character

Written 2026-10-21, after a conversation with the author. Built the same
day. The author confirmed WebP for screenshots and the raised limit, and
renamed the character Yaku Neko. One change from below: the upload sends the
image's own bytes, typed `image/*`, with the character in the query, rather
than a form, because SvelteKit refuses a cross-site-looking form post and,
behind Tailscale, cannot always tell it is not one.
**default** marks a choice the author was not asked about.

## Why

The author saves cute screenshots and GIFs of characters. Today that means
pasting into Obsidian, finding or making the character's note, and moving the
file. `Cute/` holds one character note so far, `Yani Neko.md`, with two
screenshots in `Cute/images/` (4.2 MB) and three Reddit image links whose
markdown is half-broken (`[![…](url)` with no closing bracket).

The tab makes filing one paste and one tap, and makes each character's images
easy to look through.

## The journey

1. Open **Cute**. A drop box sits at the top; under it, the grid of
   characters, each a tile with a cover image, its name and how many images it
   has.
2. Drag a file onto the box, or press Cmd-V with an image on the clipboard.
   The box shows a preview, and the grid switches to choosing: every tile
   reads "Add here", and a **New character** tile appears first.
3. Tap a tile. The image is filed to that character and the box is ready for
   the next one. Or tap **New character**, type a name, and it is made and
   filed in one go. **Cancel** drops the preview; nothing is written.
4. Tap a character, when not choosing, to open it: every image and GIF in a
   grid, newest first; tap one to see it full size, GIFs playing.

Nothing is written until step 3, so a wrong paste costs nothing.

## Decisions

1. **No AI by default.** The author chooses the character. Detection may come
   later as a suggestion that pre-selects a tile (see Later); it must never
   file on its own (CLAUDE.md: no vault write from a model without an accept
   step).
2. **A character is one note, `Cute/<Name>.md`.** Its images are embed lines,
   `![[<file>]]`, one per line, appended at the end. Lines already there are
   never moved or rewritten, so `Yani Neko.md` keeps its current lines as they
   are. The note still reads normally in Obsidian.
3. **Images live in `Cute/images/`**, named `<Name> <YYYYMMDD-HHMMSS>.<ext>`,
   so a file says whose it is and two never clash. Obsidian resolves the embed
   by file name.
4. **The grid's order is most recently added first** (**default**), from each
   note's last embed. The cover is that newest image (**default**).
5. **Accepted files:** PNG, JPEG, GIF and WebP, checked by their first bytes,
   not their name. Anything else is refused with a sentence (**default**: no
   video in the first version).
6. **Size.** Screenshots (PNG, JPEG) are converted to WebP at high quality
   before saving, typically several times smaller; GIFs are kept as they are
   (**default**, not yet confirmed). A file over 25 MB is refused
   (**default**). Every image stays in the vault's git history for good, so
   this decides how fast the repo grows.
7. **A new character's name** must make a valid file name, and may not
   repeat an existing one, ignoring case. The existing note keeps its name,
   `Yani Neko` (**default**; the Reddit posts say "Yaku Neko", so the author
   may want to rename it in Obsidian).

## Known limits

- **A GIF copied in a browser usually pastes as a still image.** The
  clipboard holds a PNG of its first frame. Dragging the file in keeps it
  animated; the box says so when a pasted image is a still.
- **Phones cannot drag, and paste only sometimes.** The box is also a "Choose
  file" button, which opens Photos.

## Build order

1. **Binary files in the vault module.** `Vault.writeBytes` and
   `readBytes`, behind the same path and scope rules as `write`, so
   filesystem access stays in `src/lib/server/vault/`. Table-tested.
2. **Serving an image.** `GET /cute/media/<file>`: only a file directly in
   `Cute/images/`, content type from its first bytes, long cache headers,
   `nosniff`. Never anything else in the vault.
3. **Uploading.** `POST /api/cute` with the file and the character (or a new
   name): checks type and size, converts to WebP when decided, writes the
   file, appends the embed (a guarded insertion through `rewrite`), and
   creates the note for a new character. Raise the server's request limit
   (adapter-node defaults to 512 KB, so a 2 MB screenshot is refused today):
   `BODY_SIZE_LIMIT` in `deploy/` and the container's unit.
4. **The tab.** `cute` in `MODULES`, characters under it in the rail, the
   drop box, the grid with its choosing state, the character page and the
   full-size viewer.
5. **e2e.** Paste, drop and choose-file each file an image byte for byte (or
   as WebP when that is decided); a new character makes its note; Cancel
   writes nothing; an existing note's lines are untouched.

## Later

- **Suggesting the character.** Send the image and the list of characters to
  the `claude` CLI; pre-select its answer's tile. Needs a spike first: the
  CLI runs with no tools, so the image would have to travel in the message
  itself, which is unproven here, and Claude has to be signed in on the
  container.
- **Paste a URL** and have the server fetch the image (the Reddit links).
- **Tidy `Yani Neko.md`'s broken Reddit links**, as a proposal to accept.
