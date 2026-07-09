![Version 1.0.1](https://img.shields.io/badge/Version-1.0.1-green.svg)
[![Forever Healthy](https://img.shields.io/badge/(c)_2026-Forever_Healthy-573D7D.svg)](https://forever-healthy.org)
![evipedia.ai](./docs/evipedia-header.png)

# Evipedia Widget

A small embeddable JavaScript widget that surfaces [evipedia.ai](https://evipedia.ai) — our continuously updated encyclopedia of evidence reviews on health & longevity interventions — directly on any web page.

When a reader hovers over a marked intervention name, the widget shows a compact card summarizing Evipedia's evidence review, with a click-through to the full review.

## Install

The widget is served as a single static file from evipedia.ai — no build step, no npm install:

```html
<script src="https://evipedia.ai/widget.js"></script>
<script>evipedia.init()</script>
```

Drop it into your site's shared layout or footer. It works regardless of how your site is built (Jekyll, Astro, WordPress, plain HTML) because it operates on the rendered page in the browser.

## Demo

Two live examples load the widget against live evipedia.ai data — open them and hover the highlighted terms:

- [**Automatic** mode](https://forever-healthy.github.io/evipedia-widget/docs/demo-auto.html) — scans the page text
- [**Manual** mode](https://forever-healthy.github.io/evipedia-widget/docs/demo-manual.html) — only marked `data-evipedia` terms

## Modes

The widget runs in one of two modes, set via `mode`:

**`"auto"` (default)** — scans the page's text and automatically highlights every occurrence of a known review name (canonical or alternate), with no markup required. Because it's the default, the plain `evipedia.init()` from [Install](#install) already runs in auto mode.

A few things to know:

- **It safely skips** links, buttons, code/`pre`, form fields, editable regions, and already-marked terms, so it never nests or double-links.
- **Very short names can be noisy.** Use `minAutoLength` to ignore review names shorter than a given number of characters (default `3`).
- **It rewrites the DOM**, wrapping matches in `<span class="evipedia-term">`. For dynamically added content, call `evipedia.scan()` again after the content has loaded.

**`"manual"`** — only enhances terms you've marked with `data-evipedia` (see [Manually marking terms](#manually-marking-terms) below). Nothing is highlighted unless you ask for it:

```html
<script>evipedia.init({ mode: "manual" })</script>
```

## Manually marking terms

Marking terms explicitly is the **opt-in** approach — the widget enhances only the terms you mark, so it never rewrites your content unexpectedly. Marked terms are honored in the default `auto` mode, and setting `mode: "manual"` restricts the widget to *only* these marks:

```html
Consider <span data-evipedia="riboflavin">riboflavin</span> for migraine prophylaxis.
```

The `data-evipedia` value is matched (case-insensitively) against each review's slug, canonical name, and alternate names. Only terms that resolve to a review get a subtle dotted underline and a hover card — unknown terms are left completely untouched.

## Configuration

`evipedia.init(options)` accepts:

| Option | Default | Description |
|---|---|---|
| `mode` | `"auto"` | `"auto"` (scan page text) or `"manual"` (enhance only marked terms) |
| `autoLinkOnce` | `true` | Auto mode: link each distinct term at most once (a repeated term links once; a review named under several terms links once per term) |
| `minAutoLength` | `3` | Auto mode: ignore review names shorter than this many characters |
| `showDelay` | `120` | ms to hover before the card appears |
| `hideDelay` | `220` | ms grace after leaving, so the pointer can reach the card |
| `debug` | `false` | Log matching/loading diagnostics to the console |

## API

| Call | Description |
|---|---|
| `evipedia.init(options)` | Load the reviews index and enhance marked terms once the DOM is ready. |
| `evipedia.scan()` | Re-scan the page for newly-added marked terms. Idempotent — safe to call after client-side navigation or late-rendered content (SPAs). Returns a promise that resolves to the count of newly enhanced terms. |
| `evipedia.version()` | Return the widget version string. |

## Architecture

The widget is a **thin client over evipedia.ai's public endpoints** — it fetches the reviews index live from `https://evipedia.ai` and bundles no data of its own. The reviews index contains everything the hover card needs (`canonical_name`, `er_conclusion`, `permalink`), so it is fetched **once**, and terms are resolved from memory — hovering triggers no further requests.

The card is rendered inside a **Shadow DOM**, so the host page's CSS can't affect it, and its styles can't leak onto your page. The only style it injects into the host page is a minimal dotted-underline affordance on matched terms.

| Endpoint | Description |
|---|---|
| `GET /reviews.json` | Catalog: `canonical_name`, `alternate_names[]`, `permalink`, `category`, `creation_date`, `er_conclusion` |
| `GET /{permalink}` | Full evidence review (the card's click-through target) |

> **Cross-origin note.** Because the widget runs on partner origins and fetches `reviews.json` from evipedia.ai, that endpoint is served with `Access-Control-Allow-Origin: *`.

## License

MIT — see [LICENSE](./LICENSE).
