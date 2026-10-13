# Evipedia Widget - Change Log


### v1.0.10 — 2026-09-21

* Hover card on stacked terms: moving from a term down (or up) into its card no longer switches to the card of a term on the next line. The gap between term and card counts as part of the card, and switching to another term while a card is open needs a longer rest on it (400 ms)
* Fixed the card sometimes closing while the pointer was already on it (a stale hide timer from an earlier term still fired)
* Number ranges: a term directly followed by a dash plus a digit is no longer matched, e.g. "C10" (an MCT alias) in "C10-30 Alkyl Acrylate"

### v1.0.9 — 2026-09-19

* Unicode-aware word boundaries: terms no longer match inside words with non-ASCII letters, e.g. "gegen" (a Kudzu alias) inside German "gegenüber"
* "gegen" (German for "against") is no longer auto-highlighted on its own — explicit data-evipedia marks still work

### v1.0.8 — 2026-09-18

* Auto mode now matches plurals: a trailing "s" ("statins", "GLP-1s", "AGEs") links to the singular's review. An uppercase "S" never pluralises an acronym ("AGES" is not AGE)

### v1.0.7 — 2026-09-18

* New opt-in `observe` option: watches the page for content added or edited after load (single-page apps, infinite scroll) and highlights terms in it automatically, throttled to one pass per burst of changes

### v1.0.6 — 2026-09-13

* More everyday words are no longer auto-highlighted on their own: "adam", "molly" (MDMA), "elder" (Elderberry), "bailing" (Cordyceps), "vegetal" (Ayahuasca), "melissa" (Lemon Balm) — explicit data-evipedia marks still work

### v1.0.5 — 2026-09-13

* "acid" is no longer auto-highlighted on its own: it matched the LSD review's slang alternate name, so e.g. "fatty acid" linked to LSD (names containing it, like "Citric Acid", still match; explicit data-evipedia marks still work)

### v1.0.4 — 2026-09-13

* On an ambiguous alternate-name match between equally general reviews, link the review whose own name contains the term (e.g. "Aspirin" → Low-Dose Aspirin, not the ECA stack — which also fixes aspirin not being highlighted on the ECA review page)

### v1.0.3 — 2026-09-12

* A rejected auto-match no longer swallows the text it covers: when the longest matching name can't be linked (it points at the current page, is an acronym in the wrong casing, or was already linked), shorter known names starting at the same spot are tried, so a term is highlighted at its FIRST occurrence on the page instead of a later one

### v1.0.2 — 2026-07-09

* On an ambiguous alternate-name match, link the general "Health & Longevity" review instead of a condition-specific one (e.g. "Ascorbic Acid" → Vitamin C, not High-Dose Vitamin C for cancer)

### v1.0.1 — 2026-07-09

* Fixed Safari & Mobile compatibility issues

### v1.0.0 — 2026-07-08

* 1st public release
