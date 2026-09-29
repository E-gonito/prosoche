# Design

Paper and ink: warm, personal, calm. One file, `src/app.css`, holds the tokens
and the shared classes; a component's own `<style>` holds only its own
business. A unit test reads this page and `src/app.css` together, so a token
named here and missing there fails the build. Light theme only.

## Tokens

Paper, from the desk up, and ink:

```css
--bg: #f7f3ec; --panel: #fffdf9; --soft: #f1ebe1; --line: #e6ddd0;
--text: #2a2622; --muted: #7a7068;
```

Teal is for anything you can press; sand is for an aside worth reading. Both
come from the meeting-primer artifact the author already liked.

```css
--accent: #2e6b85; --accent-soft: #e3eef2;
--sand: #efe6da; --sand-edge: #b07a3a;
--q1: #c2553f; --q2: #2e6b85; --q3: #c8962b; --q4: #a39a90;
--ok: #3f7d4e; --warn: #a8641c; --bad: #b3372b;
```

Type. Headings are Source Serif 4, self-hosted through
`@fontsource-variable/source-serif-4`; body text is the system sans at 15px.

```css
--serif: 'Source Serif 4 Variable', 'Iowan Old Style', Georgia, serif;
--sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif;
--mono: ui-monospace, SFMono-Regular, Menlo, monospace;
--t11: 11px; --t12: 12px; --t13: 13px; --t14: 14px; --t15: 15px;
--t16: 16px; --t20: 20px; --t24: 24px; --t30: 30px;
```

Spacing on a four-pixel step, radii, elevation and fields:

```css
--s1: 4px;  --s2: 8px;  --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px;
--r-sm: 6px; --r-md: 8px; --r: 10px; --r-lg: 12px; --r-pill: 999px;
--shadow: …; --shadow-lg: …;
--field: #fffdf9; --focus: 2px solid var(--accent);
```

The shell's furniture, measured once:

```css
--rail-w: 232px; --header-h: 52px; --tabbar-h: 60px;
--read-w: 860px; --page-chrome: calc(var(--s6) * 2);
```

A value off these scales is allowed and says why where it is written: the
44px a thumb needs, the timeline's pixels per minute.

## Breakpoints

A media query cannot read a custom property, so two widths are written out:

- **720px**: a phone. The rail becomes a bottom bar of four modules plus
  More, a slim header carries the brand, search and sync dot, and pages pad
  for the bar.
- **1100px**: a page's side column (a note's links, a day's week view) drops
  under its main column.

## Layout rules

- **Few boxes.** Sections are separated by a `.label` and by space. A box is
  for a thing you act on as a unit (a sheet of rows, a card, a form).
- **A page is a reading column.** `.page` centres an 860px column, as the
  primer artifact does; `.page.wide` is for boards and two-column pages.
- **Titles are serif.** `.title h1` is the page heading, with one line of
  small print under it. Nothing else on a page is as large.

## Shared classes

- **`.page`, `.page.wide`**: the page column.
- **`.title`**: a page's heading block; `.crumb` is the small link above it.
- **`.label`**: a section label in small capitals, with an optional `.right`.
- **`.sheet`** and **`.rows`**: white paper with a hairline edge, and rows
  inside it divided by hairlines rather than boxed one by one.
- **`.callout`**: sand with a warm rule down the left; its first `<b>` is the
  lead-in ("Rate limit:" in the primer).
- **`.tabs`**: an underlined row of links across a page. Each tab is a URL;
  the current one has `aria-current="page"`.
- **`.btn`** (`.primary`, `.ghost`, `.danger`, `.small`) and **`.icon-btn`**.
- **`.field`**: any text input, textarea or select.
- **`.chip` / `.chips`**: a pill filter; `.chip.on` is selected.
- **`.badge`** (`.ok`, `.warn`, `.muted`): a small uppercase label such as
  MINE or LOOKED UP.
- **`.card`**: a panel with a small-caps `h3`, for the rare boxed group.
- **`.prose`**: rendered markdown, close to Obsidian's reading view.
- **`.q1`–`.q4`**, **`.tag`**, **`.num`**, **`.muted`**, **`.small`**,
  **`.hint`**, **`.problem`**, **`.none`**, **`.empty`**, **`.kv`**.

## Monospace

Monospace means text the vault or the machine chose: paths, tags, code,
environment variables, keyboard hints. Times, counts and dates are body text
with `.num`, which lines figures up without changing the typeface.

## Components

- **`Icon`**: every glyph, from one hand-copied Lucide path set. `name`,
  `size` (default 16), `label` (absent means decorative).
- **`Draft`**: a button that asks Claude for a proposal and shows it as a diff
  with Accept and Reject. Every AI write in the app goes through it.
- **`Capture`**: one line into an inbox note.
- **`FileTree`**: the vault's folders, used by Notes.
