# UI guide

The app's look is a plain-CSS port of [shadcn/ui](https://ui.shadcn.com) (new-york style, neutral colours), in `public/styles.css`. There is no React, Tailwind or build step: pages are static HTML plus small ES modules, and the class names follow shadcn's component names so the shadcn docs read across.

- Font: Geist (variable, self-hosted in `public/fonts`, SIL OFL).
- Icons: Lucide, shadcn's icon set. In JS, `icon("plus")` from `/lib.js` (or `/icons.js`) returns an inline SVG. In static HTML, write `<span data-icon="plus"></span>`; `lib.js` swaps it for the SVG on load. Add icons to `public/icons.js` from the `lucide-static` package when you need a new one.
- Light and dark mode follow the device.
- Phone first: a sticky header, a bottom tab bar under 640px, and a top nav above it. Inputs are 16px on phones so iOS does not zoom.

## Page shell

Every app page uses the same head, header, `<main class="container">` and tab bar. Copy them from `public/retreats.html` and set `aria-current="page"` on the right links (Home, Retreats, Recipes or Pantry; pages under a section mark that section). Printables use a toolbar instead of the tab bar (see `print-day.html`) and add `class="no-tabbar"` to `<body>`.

```html
<div class="page-header">
  <div>
    <a class="back-link" href="/retreats.html"><span data-icon="chevron-left"></span>Retreats</a>
    <h1>Title</h1>
    <p>One line of context.</p>
  </div>
  <div class="actions"><a class="btn" href="…">Primary action</a></div>
</div>
```

`<h2 class="section-title">Upcoming</h2>` is the small uppercase label above a group.

## Components

| shadcn | Markup |
| --- | --- |
| Button | `<button class="btn">` plus `btn-secondary`, `btn-outline`, `btn-ghost`, `btn-destructive`, `btn-ghost-destructive`, `btn-link`; sizes `btn-sm`, `btn-lg`, `btn-icon` (give icon-only buttons an `aria-label`), `btn-block`. Icon first, then text. |
| Card | `<section class="card">` with `card-header` / `card-title` / `card-description` / `card-footer` (`bordered` for a footer bar). `card-flush` removes padding for edge-to-edge lists. |
| Item (list rows) | `<div class="item-list">` of `<a class="item">` with `item-media`, `item-content` > `item-title` + `item-description`, then a badge or `icon("chevron-right")`. |
| Badge | `badge`, `badge-secondary`, `badge-outline`, `badge-warning`, `badge-dashed` (unsure), `badge-destructive`; group in `.badges`. |
| Input, Select, Textarea, Label | Bare `input`, `select`, `textarea` are styled. Wrap each with its label in `<div class="field">`; `field-description` for help text; two side by side in `.grid-2`. `input-icon` (search), `input-group` + `input-addon` ("%", "people"). |
| Checkbox | Bare `input[type=checkbox]`; `<label class="check">` for checkbox + text; `checkbox-lg` for big thumb ticks. |
| Toggle group | `<div class="toggle-group">` of `<button class="toggle" aria-pressed>` or `<label class="toggle"><input type="checkbox"> Vegan</label>`. `data-state="yes" | "no"` and `.unsure` are also styled. |
| Tabs | `<div class="tabs-list" role="group">` of buttons with `aria-pressed`. |
| Collapsible / Accordion | `<details class="collapsible"><summary>Title <span class="summary-meta">3</span></summary><div class="collapsible-body">…</div></details>`; wrap several in `.accordion` for dividing lines. |
| Table | Bare `table`; `td.num` for right-aligned amounts. |
| Alert | `<div class="alert alert-warning">${icon("circle-alert")}<p class="alert-title">…</p><p class="alert-description">…</p></div>` |
| Empty | `<div class="empty"><div class="empty-media">${icon(…, {size: 20})}</div><p class="empty-title">…</p><p class="empty-description">…</p><div class="actions">…</div></div>` |
| Skeleton | `skeleton(3)` from `/lib.js` while loading. |
| Sonner (toast) | `toast("Saved")`, `toast(message, { error: true })`. |
| Alert dialog | `if (!(await confirmDialog({ title, description, confirm: "Delete" }))) return;` Never use `confirm()`. |
| Separator | `<hr>` or `.separator`. |

Other helpers in `/lib.js`: `busy(button, async () => …)` shows a spinner and blocks double taps; `meta-row` for "icon + fact" lines; `stats`/`stat` for number tiles.

Layout helpers: `stack`, `stack-sm`, `stack-lg`, `row`, `spread`, `grow`, `actions`, `muted`, `small`, `xs`, `medium`, `strong`, `num`, `warn`.

## Writing style on screen

Plain words the chef uses, sentence case, no exclamation marks. Buttons say what they do ("Save recipe", "Copy list"). Destructive actions ask first through `confirmDialog`.

## Printing

`@media print` hides the header, tab bar, buttons and anything with `no-print`, and prints black on white. Printables (`print.css`) are laid out for A4.
