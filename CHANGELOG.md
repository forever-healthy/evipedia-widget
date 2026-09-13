# Evipedia Widget - Change Log


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
