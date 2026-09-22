# Design

What every screen is made of. One file — `src/app.css` — holds the tokens and
the shared classes; a component's own `<style>` block holds only what is that
component's business. A unit test reads this page and `src/app.css` together,
so a token named here and missing there fails the build.

## Tokens

Spacing, on a four-pixel step:

```css
--s1: 4px;  --s2: 8px;  --s3: 12px;
--s4: 16px; --s5: 24px; --s6: 32px;
```

Type, named by the size it is. Body text is `--t14`.

```css
--t11: 11px; --t12: 12px; --t13: 13px; --t14: 14px;
--t16: 16px; --t20: 20px; --t24: 24px;
```

Radii, elevation, fields and focus:

```css
--r-sm: 6px; --r-md: 8px; --r: 10px; --r-lg: 12px; --r-pill: 999px;
--shadow: 0 6px 18px rgba(31, 35, 40, 0.18);      /* lifted off the page */
--shadow-lg: 0 18px 48px rgba(31, 35, 40, 0.18);  /* floating over it */
--field: #fff;                /* anything you type or choose into */
--focus: 2px solid var(--accent);
```

Colour, from the approved mockup. Light theme only; there is no dark variant
and no plan for one.

```css
--bg: #f6f7f9; --panel: #ffffff; --soft: #f0f2f5; --line: #e3e6eb;
--text: #1f2328; --muted: #6b7280;
--accent: #2f6fed; --accent-soft: #e8f0fe;
--q1: #d9534f; --q2: #2f6fed; --q3: #e0a100; --q4: #9aa0a6;
--ok: #16a34a; --warn: #b45309; --bad: #b91c1c;
--mono: ui-monospace, SFMono-Regular, Menlo, monospace;
```

The shell's own furniture, measured once so nothing guesses at it:

```css
--header-h: 48px;
--tabbar-h: 56px;
--page-chrome: calc(var(--header-h) + 40px);
```

A value off these scales is allowed, and has to say why where it is written:
the timeline's pixels-per-minute arithmetic, the 44px minimum a thumb needs,
the 220px a board column needs to hold a readable card.

## Breakpoints

Two, and a media query cannot read a custom property, so both are written out
literally everywhere they appear:

- **720px** — a phone. One column, the sidebar becomes the bottom tab bar,
  hover-only affordances come out into the flow.
- **960px** — too narrow for two widgets side by side, so each takes the row.

A page whose own two columns stop fitting at some other width may name that
width; three do. Nothing else invents one.

## Shared classes

- **`.btn`** — every button and button-shaped link. `.primary` is the one
  action a screen is for, `.ghost` is quiet, `.danger` is destructive and
  never the default, `.small` fits inside a row of text.
- **`.icon-btn`** — a borderless square button that is only its icon. Callers
  keep their own `data-testid` and `aria-label`; the class says nothing about
  what the icon means.
- **`.card`** — a panel. `.card h3` is its heading: a small uppercase label,
  with at most one count or control in a `.right` span. `.widget > h3` shares
  that rule, so a card and a widget cannot drift apart.
- **`.chip` / `.chips`** — a pill and the row it lives in. `.chip.on` is the
  one selected; `.chip.quiet` reports a number rather than offering a choice,
  so it loses the border and the pointer.
- **`.tag`** — a square label: a tag from a note, a file's status. `.tag.bad`
  is what a refused guardrail wears.
- **`.num`** — `font-variant-numeric: tabular-nums`, so a column of figures
  lines up.
- **`.hint` / `.problem` / `.none`** — a widget's own small print: a quiet
  aside, an inline error under its controls, its own "nothing here yet"
  smaller than `EmptyState`. A caller overrides `margin` alone where its
  layout needs a different side or amount; it never repeats the colour or
  size.
- **`.widget-grid`** — the twelve-column dense grid every dashboard uses. A
  widget states its own span against it.
- **`.prose`** — rendered note content, kept close to Obsidian's reading view.
- **`.q`, `.q1`–`.q4`** — an Eisenhower quadrant, drawn as the inline code the
  vault writes it as.

## Monospace

Monospace means "this is text the vault or the machine chose": paths, tags
such as `#ws/work`, code, environment variable names, external references
such as a commit hash, and keyboard hints.

Times, counts and dates are **not** that. They are body text with `.num` or
`font-variant-numeric: tabular-nums`, which lines the figures up without
changing the typeface. A clock, a card count, a streak and a relative date are
all things this app says, not things it quotes.

## Components

Three components exist so a pattern is written once.

**`Icon`** (`$lib/components/Icon.svelte`) draws every glyph in the app from
one hand-copied Lucide path set. Props: `name` (an `IconName`; anything else
will not compile), `size` (CSS pixels, default 16), `label` (what a screen
reader should call it — absent means decorative).

**`PageHeader`** (`$lib/components/PageHeader.svelte`) is the heading every
page wears. Props: `title`, `back` (`{ href, label }`, drawn small above the
title), `dot` (a colour, drawn before the title), `testid` (placed on the
`h1`), and two snippets — `meta` for small print beside the title and
`actions` for the buttons, which drop under the title on a phone.

**`EmptyState`** (`$lib/components/EmptyState.svelte`) is "there is nothing
here", rendered the same way everywhere it is true. Props: `icon`, `title`
(one sentence), `hint` (at most one short line), `testid`, and two snippets —
`action` for the single button that would fix it, and `children` for the rare
structured content that is not a sentence. There is deliberately no prop for a
paragraph: longer explanations belong in `how-it-works.md`.
