# Plan: Books

Written 2026-10-23, after a conversation with the author. Built the same
day, with these differences from what follows:

- The files are on a shelf outside the vault (`HUB_BOOKS`), not in
  `_hub/.books/` (decision 1).
- The frame also has `allow-forms`, because the Rust book's quiz answers are
  forms; the CSP's `form-action 'none'` still stops any submission. Each
  chapter's CSP also carries `sandbox`, so a chapter opened in a tab of its
  own is just as walled off as one in the reader.
- The Rust book's quizzes do not remember answers on their own site: mdbook-quiz
  only does that when a quiz's tag has `data-quiz-cache-answers`. Prosoche
  adds it to a saved site's quiz tags as it serves them, so answers are kept
  in the book's storage and follow the author between devices.
- pdf.js's CMaps, standard fonts, colour profiles and WASM decoders are
  served from `/pdfjs/` (`vite.config.ts`).
- The Rust book's code-editor workers cannot start in an opaque-origin frame.
  The book's 223 quiz questions are multiple choice, tracing and short
  answer, and none of those tried started an editor. A question that does
  would fail to load its editor.

**default** marks a choice the author was not asked about; **open** marks one
that is theirs to make before the step that needs it.

## Why

The author reads long technical books across a phone and a desktop: PDFs such
as CS:APP (about 1,100 pages), EPUBs, and books that are websites, above all
the interactive Rust book from Brown (`rust-book.cs.brown.edu`), whose point is
its quizzes. Today each lives in a different app, none remembers the place
across devices, and none is linked to Study. The ask:

- Adding a book is one step: drop a file, or paste a URL.
- It reads well on the phone and on the desktop.
- It opens where it was last left, on whichever device.
- It can be searched, inside a book and from the app's search box.
- It copes with a book the size of CS:APP.

## Decisions

The author's answers, 2026-10-23:

1. **The book files stay on the server, out of git.** They live on the
   shelf, `HUB_BOOKS` (`config.books.path`), one folder per book. The shelf
   is outside the vault folder entirely, so git, the file watcher and
   Obsidian never see the files, and they are never committed. The plan
   first put them at `_hub/.books/` inside the vault. That was dropped while
   building: git and the watcher would still have walked thousands of saved
   site files, even though none would be committed. A 100 MB PDF in git would bloat every
   clone for good, and GitHub refuses a single file over 100 MB. What is worth
   keeping does go in git: each book has a markdown note, `Books/<Title>.md`,
   holding its source, where the author is up to and their highlights.
2. **A URL is saved as a copy, not shown live.** A live site in a frame
   cannot be searched and cannot report where you are. So a book from a URL
   is downloaded once and kept. To get a newer version, add it again: the
   copy is replaced, and the note, place and highlights stay.
3. **Online only.** A book opens whenever the server can be reached. The
   service worker still caches nothing.
4. **Books join three parts of the app:**
   - global search;
   - Study subjects, through their reading lists;
   - highlights, saved into the book's note.

   Reading time in focus sessions was not picked.

Choices made without asking:

5. **The Rust book with quizzes is a "site" book (default).** The Brown
   edition is an mdBook site. Its quizzes are JavaScript
   (`quiz/quiz-embed.iife.js`, about 20 MB, with the Monaco editor bundled)
   that reads each quiz from the page and keeps answers in `localStorage`.
   Saving a copy means saving:
   - each chapter page, found from the book's own table of contents;
   - the pages' scripts, styles, fonts and images;
   - not `print.html`. As one 4 MB page with 93 quizzes it is too heavy for a
     phone, and a chapter is the natural unit for "where was I".

   This only works for books whose code runs from their own files, as an
   mdBook site's does. A site that needs its own server to work is out of
   scope (see Not now).
6. **One reader for anything made of HTML (default).** An EPUB is a zip of
   XHTML chapters. A site book is a folder of HTML chapters. So the server
   unpacks an EPUB into the same shape as a saved site, and both are read by
   one HTML reader. PDFs get a PDF reader. That makes two readers, not three
   (see Design it twice).
7. **Book content never runs as prosoche (default).** A chapter is shown in
   an `<iframe sandbox="allow-scripts">` with no `allow-same-origin`, so the
   page gets an opaque origin. It cannot read prosoche's pages, storage or
   cookies. It is also served with a strict CSP:
   - `connect-src 'none'`, so it cannot call prosoche's API or the internet;
     this also turns off the quizzes' research telemetry;
   - `form-action 'none'`;
   - scripts and styles from the book's own folder only.

   EPUBs carry no scripts of their own; only prosoche's bridge runs (see
   decision 8). A saved site's own scripts run, and that is what makes the
   quizzes work.
8. **A small bridge script talks to the frame (default).** Prosoche injects
   one script into every HTML chapter it serves. The script:
   - reports the place (chapter, and the nearest heading or paragraph) as the
     reader scrolls;
   - scrolls to a place, or to a search hit, and marks the hit;
   - sends a text selection up to make a highlight;
   - stands in for `localStorage`, which an opaque origin cannot use. The
     quiz answers saved there go up to the server as a side effect and are
     written back into the page when a chapter loads, so quiz progress
     follows the author from phone to desktop.

   The frame and the app talk by `postMessage`, and the app accepts only the
   messages it expects from its own frame.
9. **Where you are is in the book's note (default).**
   - The frontmatter holds `at: p. 412` for a PDF, or
     `at: ch04-02-references-and-borrowing.html#the-rules-of-references` for
     HTML, with `read_at:` as the date. Both are readable in Obsidian.
   - The reader saves the place a few seconds after you stop moving. It
     edits that one field the way every other field is edited.
   - Git already batches dirty files into one commit some minutes after the
     last save, so a reading session is one commit, not hundreds.
   - When two devices are open on one book, the last one to save wins.
   - Opening a book that another device has moved on shows "Continue from
     p. 430 (phone)?" rather than jumping without asking.
10. **Big PDFs (default).** The reader uses pdf.js. The server answers HTTP
    range requests, so opening page 412 of CS:APP on the phone fetches what
    page 412 needs, not the whole file. Only the pages near the screen are
    drawn. Each page gets a text layer, so text can be selected and search
    hits can be marked. On a phone the page fits the width, and pinching
    zooms. A PDF cannot reflow, so a book that has an EPUB edition reads
    better on the phone as the EPUB.
11. **Search uses text the server pulls out once (default).**
    - When a book is added, the server pulls out its text, one entry per PDF
      page or HTML section. It runs in a worker thread, one book at a time,
      and the Books tab shows progress ("Indexing CS:APP, page 312 of 1,120").
    - The text is kept as `_hub/.books/<id>/text.json`. An index rebuild
      reloads that file and does not extract again.
    - The text goes into its own SQLite FTS5 table, beside `notes_fts`, so
      SQL stays in `index/`.
    - Searching inside a book lists hits with snippets, and choosing one
      opens it with the hit marked. The app's search box shows a "Books"
      group under the notes.
    - A scanned PDF with no text layer still opens, but its card says
      "No searchable text in this PDF". OCR is not in this plan.
12. **A book's id comes from what it is (default).** A file's id is a hash of
    its bytes. A site's id comes from its URL. So uploading the same CS:APP
    again, for example after the server is rebuilt, finds the existing note
    and its place and highlights instead of making a second book. Losing the
    server loses only the files, never the place or the highlights.
13. **Highlights go in the note (default).** Select text, then tap Highlight.
    A line is added under `## Highlights` in the book's note:

    ```
    - > the quoted words — p. 412
    ```

    The quoted words and the place are enough to find the spot again. Only
    that one line is added; nothing else in the note changes. A highlight can
    carry a short comment of yours on the next indented line. Highlights are
    marked again when that page is opened.
14. **Study, through the reading list (default).** A reading-list item whose
    title links to a book note (`[The Rust Book](Books/The Rust Book.md)`)
    gets a "Read" button that opens the book at its place. When a subject has
    a book in its Reading column, a study block's focus view shows
    "Continue: The Rust Book, ch. 4.2". The reading-list line grammar does not
    change: the link is an ordinary markdown link that Obsidian also opens.
15. **Uploading (default).** The Books tab takes a dropped file, a file
    picker (which on a phone opens Files, or Drive) or a pasted URL.
    - The upload is the file's raw bytes, typed `application/pdf` or
      `application/epub+zip`, as the Cute images are. That way SvelteKit's
      cross-site check holds without `ORIGIN` being set.
    - The route streams the bytes to disk rather than holding them in memory.
      The container has 1.5 GB of RAM, and a CS:APP-sized file should not
      have to fit in it.
    - The container's `BODY_SIZE_LIMIT` (30 MB today) goes up to 500 MB.
      Every other upload route keeps its own smaller limit.
    - A URL is fetched by the server, which refuses private and tailnet
      addresses, as `notify.ts` already does for push endpoints.

## Design it twice: how many readers

- **A.** Three readers: pdf.js for PDF, epub.js for EPUB, and a frame for
  sites. That means three ways of saying "where am I", three ways of marking
  a search hit, and three ways of making a highlight. epub.js is barely
  maintained.
- **B, picked.** Unpack an EPUB on the server into HTML chapters, so EPUBs
  and sites share one HTML reader and one bridge, and PDFs keep pdf.js. Two
  kinds of place (`p. N`, and `chapter#anchor`), one text extractor for all
  HTML, and one safety rule for all HTML. What an EPUB loses is page-flip
  pagination. The HTML reader scrolls, as the Rust book already does.

## Screens

The Books tab:

```
  Books                                 [ + Add a book or URL ]
  [ Search all books ]

  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
  │ CS:APP        │ │ The Rust Book │ │ <EPUB>        │
  │ PDF · p. 412  │ │ site · ch 4.2 │ │ 31%           │
  │ of 1,120      │ │ 12/93 quizzes │ │               │
  └───────────────┘ └───────────────┘ └───────────────┘
  Disk: 2.1 GB free on the server
```

The reader (the phone is the same, with the toolbar collapsed to one icon):

```
  ‹ Books   The Rust Book · 4.2 References and Borrowing   [search] [≡ contents] [Aa]
  ┌──────────────────────────────────────────────────────────────┐
  │                 the chapter, in its own frame                 │
  │                    (quiz: [ Start ])                          │
  └──────────────────────────────────────────────────────────────┘
       selecting text shows  [ Highlight ]
```

## Build order

1. **Storage and notes.**
   - Add `_hub/.books/` to the never-committed paths, and keep the watcher
     and the note index out of it.
   - A `server/books/` module: add, list, read, delete, and the book note's
     fields.
   - Pure, table-tested functions for the `at:` field, the `## Highlights`
     line, and the id.
2. **PDF.** The streamed upload route, the range-request file route, and the
   pdf.js reader with lazy pages. Saving and restoring the place. Test it
   with a real CS:APP-sized PDF on the phone before going further.
3. **Search.** The text-extraction worker, `text.json`, the FTS table in
   `index/`, search inside a book, and the Books group in global search.
4. **HTML reader and EPUB.** Unpacking EPUBs, the sandboxed frame, the
   strict CSP, and the bridge (place, jump, mark).
5. **Site books, and the Rust book with quizzes.**
   - Save an mdBook site from its table of contents.
   - The `localStorage` stand-in and quiz progress.
   - First prove that the quizzes run under the sandbox and the CSP. If
     Monaco or the quiz script will not run there, the fallback is to serve
     site books from a second origin: another Tailscale Serve port on the
     same container. That keeps the isolation without the sandbox, but quiz
     answers would then stay on each device.
6. **Highlights and Study.** Highlight from a selection, marking highlights
   again when a page opens, the reading list's Read button, and Continue in
   the focus view.
7. **e2e.** Fixture PDF, EPUB and saved site. Add each, read, leave, come
   back to the same place, search, highlight, and check the note's bytes.

Steps 1 and 2 already give a reader for CS:APP. Step 5 is the Rust book.

## Open

- **Backups (open).** The book files exist only in the container. Proxmox
  could not be checked from `dev` on 2026-10-23. If LXC 108 is not in a
  backup job, losing it loses the files. Decision 12 means you get your place
  and highlights back by uploading the files again, but you need copies of
  the files to do that.
- **Disk (open).** The container has about 4 GB free. CS:APP is up to about
  100 MB; the saved Rust book is about 40 MB, mostly the quiz script, which
  is stored once per book. A shelf of 20 to 30 books may mean growing the
  disk. The Books tab shows what is free, and refuses an upload that would
  leave less than 500 MB.

## Not now

- Offline reading on the phone (not picked).
- Reading time per focus session (not picked).
- OCR for scanned PDFs.
- Sites that need their own server to work, and sites that are not mdBook
  books. A general web page could later be saved as one chapter.
- Sharing a file from another Android app straight into prosoche (Web Share
  Target). It needs a multipart post, which brings back the origin check
  that the raw-bytes upload avoids.
- Annotating PDFs with ink, and exporting highlights anywhere but the note.

## Modules (as built)

| File | Owns |
|---|---|
| `server/vault/shelf.ts` | Every filesystem call for books: streamed writes, range reads, removal, free space |
| `shared/books.ts` | Types shared with the browser: `Place`, `BookManifest`, `BookSummary`, bridge messages |
| `server/books/id.ts` | A book's id, from its bytes or its URL |
| `server/books/manifest.ts` | The layout of a book's folder, and `book.json` |
| `server/books/note.ts` | The note `Books/<Title>.md`: its fields, `at:`, `## Highlights` lines (pure) |
| `server/books/library.ts` | The one module routes call: list, add (upload or URL), place, highlight, remove |
| `server/books/pdf.ts` | A PDF's title, page count and outline |
| `server/books/text.ts` | Pulling text out, `text.json` |
| `server/books/search.ts` | The text queue, reindexing at start, searching |
| `server/books/epub.ts` | Unpacking an EPUB into `html/` |
| `server/books/site.ts` | Saving an mdBook site into `html/`, with the address checks |
| `server/books/chapter.ts` | Serving `html/` into the frame: CSP, the bridge, types |
| `server/books/bridge.ts` | The bridge script's source |

Routes:

| Route | What |
|---|---|
| `GET /api/books` | `{ books: BookSummary[], free }` |
| `POST /api/books?name=<file>` | The raw bytes, typed `application/pdf` or `application/epub+zip`: add a book |
| `POST /api/books` with JSON `{ url }` | Save a site |
| `GET /api/books/<id>` | `{ book, manifest, highlights }` |
| `PATCH /api/books/<id>` with `{ at }` | Save the place |
| `DELETE /api/books/<id>` | Remove the files; the note stays |
| `POST /api/books/<id>/highlights` with `{ quote, at, comment? }` | Add a highlight |
| `PUT /api/books/<id>/storage` with `{ items }` | A site's `localStorage` |
| `GET /api/books/search?q=&book=` | `{ hits: BookHit[] }` |
| `GET /books/<id>/file` | The original PDF, with range requests |
| `GET /books/<id>/c/<path>` | A chapter or asset, for the frame |
| `/books`, `/books/<id>` | The Books tab and the reader |
