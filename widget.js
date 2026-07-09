/*!
 * evipedia-widget — embeddable hover-card widget for evipedia.ai
 * (c) 2026 Forever Healthy Foundation — MIT License
 *
 * Highlights opt-in marked intervention terms on any web page and shows a
 * compact evidence-review card on hover, with a click-through to the full
 * review on evipedia.ai.
 *
 * Thin client over evipedia.ai's public endpoints — bundles no data of its own.
 * The whole card is rendered inside a Shadow DOM so the host page's CSS can't
 * touch it and its CSS can't leak out.
 *
 *   <script src="https://evipedia.ai/widget.js"></script>
 *   <script>evipedia.init()</script>
 *
 *   Consider <span data-evipedia="riboflavin">riboflavin</span> for migraine.
 */
(function (global) {
  "use strict";

  var VERSION = "0.1.0";

  var BASE_URL = "https://evipedia.ai"; // where reviews.json and reviews are served
  var ATTR = "data-evipedia";           // attribute that marks opt-in terms

  var DEFAULTS = {
    mode: "auto",                   // "auto" (scan page text) | "manual" (opt-in marks only)
    minAutoLength: 3,               // auto mode: ignore review names shorter than this
    autoLinkOnce: true,             // auto mode: link each distinct term at most once
    showDelay: 120,                 // ms hover-in before the card appears
    hideDelay: 220,                 // ms grace so the pointer can reach the card
    debug: false
  };

  // Auto-mode false-positive control. Many review names collide with ordinary
  // English words; blanket-skipping common words is wrong (coffee, zinc, ginger
  // ARE the interventions and should link). Two targeted layers instead:
  //
  //   1. Acronym names (SAMe, EMS, AGE, HIT, MT-II) match CASE-SENSITIVELY — see
  //      isAcronymName() + the case gate in autoWrap(). The lowercase word
  //      ("same", "age", "hit") is left alone; only the exact acronym casing
  //      links. This self-maintains as new acronym reviews are added.
  //   2. AUTO_STOPWORDS below — the residual non-acronym homographs that layer 1
  //      can't catch because they are Title/lowercase common words (e.g. "His"
  //      for Histidine, which appears capitalized at every sentence start). These
  //      are never auto-highlighted, but STILL resolve when an author marks them
  //      explicitly with data-evipedia (manual mode is unaffected).
  //
  // Keep this list tiny and deliberate — only add a term after confirming its
  // everyday meaning is almost never the intervention.
  var AUTO_STOPWORDS = { "his": 1, "gal": 1, "sar": 1 };

  var config = null;         // resolved options, set by init()
  var indexPromise = null;   // Promise<{ byKey, names }>, reviews.json fetched once
  var ui = null;             // lazily-created Shadow-DOM card controller
  var linkedTerms = {};      // normalized term -> true, for autoLinkOnce de-duping

  function log() {
    if (config && config.debug) {
      console.log.apply(console, ["[evipedia-widget]"].concat([].slice.call(arguments)));
    }
  }

  // ---- data layer ---------------------------------------------------------

  // Normalize any term/name to a lookup key: lowercase, spaces -> hyphens.
  function norm(s) {
    return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, "-");
  }

  // An "acronym" name is a single-token abbreviation written with capitals —
  // all-caps (EMS, CBD, HIT, AGE, MSG) or uppercase-heavy mixed case (SAMe,
  // MT-II, n-HA, 5-HTP). It means the intervention ONLY in that exact casing; the
  // lowercase form is an ordinary word ("same", "age", "hit"), so auto mode
  // matches these case-sensitively (see autoWrap).
  //
  // Two guards keep ordinary names OUT of this set, so they keep matching
  // case-INSENSITIVELY and link no matter how the page capitalises them:
  //   - Multi-word names are never acronyms — e.g. "Vitamin B6", "Aged Garlic
  //     Extract", "MCT Oil" — so "mct oil" in lowercase prose still matches.
  //   - The test is "more uppercase than lowercase letters", NOT "has any
  //     capital", so Title-Case words (Coffee, Zinc, Silicon) are excluded even
  //     though they start with a capital.
  function isAcronymName(name) {
    var s = String(name == null ? "" : name).trim();
    if (!s || /\s/.test(s)) return false;             // multi-word => not an acronym
    var upper = (s.match(/[A-Z]/g) || []).length;
    var lower = (s.match(/[a-z]/g) || []).length;
    return upper > 0 && upper > lower;
  }

  // Last non-empty path segment of a permalink, e.g. "/reviews/riboflavin/" -> "riboflavin".
  function permalinkTail(permalink) {
    var parts = String(permalink || "").split(/[?#]/)[0].split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
  }

  // evipedia serves several pages off one review slug: the canonical page
  // (/slug, from `permalink`) plus derived pages — /slug_er (evidence review),
  // /slug_er_qa and /slug_qrs_qa (audits). Strip such a suffix from a path's
  // last segment so a derived page reduces to the review's canonical /slug.
  // Longest suffixes first so "_er_qa" isn't shortened to "_er".
  var PAGE_SUFFIX = /_(?:er_qa|qrs_qa|er|qrs)$/;
  function stripPageSuffix(pathname) {
    var p = String(pathname || "").replace(/\/+$/, "");
    var i = p.lastIndexOf("/");
    return p.slice(0, i + 1) + p.slice(i + 1).replace(PAGE_SUFFIX, "");
  }

  // Absolute URL for a review, resolving relative permalinks against baseUrl.
  function reviewUrl(permalink) {
    try {
      var u = new URL(permalink, BASE_URL + "/");
      // Only allow web links; reject javascript:/data:/etc. so a bad permalink
      // can never become a clickable script on a partner's page.
      return (u.protocol === "https:" || u.protocol === "http:") ? u.href : BASE_URL;
    } catch (e) {
      return BASE_URL;
    }
  }

  // Local dev previews (`jekyll serve` on localhost) fetch reviews.json from
  // BASE_URL (evipedia.ai) but render on 127.0.0.1, so a review's host and the
  // page's host differ even though the preview IS an evipedia instance. Treat
  // local hosts as evipedia so self-exclusion still applies on the dev server. A
  // real partner embed is never served from localhost, so its behavior is
  // unchanged (its host still won't match, so it's never wrongly self-excluded).
  function isLocalHost(hostname) {
    var h = String(hostname || "").toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]" ||
           h.slice(-10) === ".localhost" || h.slice(-6) === ".local";
  }

  // True if a review's link points at the page we're already on (e.g. the widget
  // running on evipedia.ai itself) — no sense highlighting a term that just
  // links back to the current page. Compares host + path, ignoring query/hash.
  // A review's `permalink` is its canonical /slug, but the same review is also
  // shown on derived pages (/slug_er, /slug_er_qa, /slug_qrs_qa). So we match
  // the current page either exactly OR after stripping that page suffix, so the
  // review is recognized as "self" on its evidence-review and audit pages too.
  function pointsToCurrentPage(review) {
    try {
      var a = new URL(reviewUrl(review.permalink));
      var b = new URL(window.location.href);
      // Host must match (so partner embeds are never self-excluded), except on a
      // local dev preview, which serves reviews.json from evipedia.ai but renders
      // on localhost — there, fall through to the path comparison.
      if (a.host.toLowerCase() !== b.host.toLowerCase() && !isLocalHost(b.hostname)) return false;
      var ap = a.pathname.replace(/\/+$/, "");
      var bp = b.pathname.replace(/\/+$/, "");
      return ap === bp || ap === stripPageSuffix(bp);
    } catch (e) {
      return false;
    }
  }

  // Build the lookup from reviews.json:
  //   byKey — normalized key -> review, indexed under every plausible key
  //           (slug/id, canonical name, alternate names, permalink tail) so a
  //           marked term matches however the partner spelled it.
  //   names — human-readable names (canonical + alternates), for auto matching.
  //
  // Keys are claimed first-wins, but in TWO passes so a term that is a review's
  // CANONICAL name (or slug/permalink) always beats the same term being merely an
  // ALTERNATE of another review — regardless of reviews.json order. Without this,
  // e.g. "PCSK9 Inhibitors" (canonical of its own review, but also an alternate
  // of the earlier "Evolocumab vs. Alirocumab" comparison review) would resolve
  // to the comparison review and mis-link (or self-exclude) instead of pointing
  // at its dedicated review.
  function buildIndex(reviews) {
    // acronymForms: normalized key -> [exact acronym spellings], so auto mode can
    // require an acronym match to use its real casing (see autoWrap).
    var data = { byKey: {}, names: [], acronymForms: {} };
    if (!Array.isArray(reviews)) {
      log("reviews.json was not an array", reviews);
      return data;
    }
    // Whether a review's topic is the general "… for Health & Longevity" one
    // (vs. a condition-specific angle like "… to Treat Cancer"). canonical_topic
    // is optional in reviews.json — absent → false, so this is a no-op until the
    // upstream field lands.
    function isGeneralTopic(review) {
      var t = String(review.canonical_topic || "").toLowerCase();
      return t.indexOf("health & longevity") !== -1 ||
             t.indexOf("health and longevity") !== -1;
    }
    var strong = {}; // keys claimed by Pass 1 — never overridden by an alternate
    function claim(k, review) {
      var key = norm(k);
      if (key && !data.byKey[key]) { data.byKey[key] = review; strong[key] = true; }
    }
    // When an ALTERNATE name matches two reviews (e.g. "Ascorbic Acid" is an
    // alternate of both "Vitamin C" and "High-Dose Vitamin C to Treat Cancer"),
    // prefer the general health-&-longevity review over a condition-specific one.
    // Any other collision keeps first-in-array order, as before.
    function claimAlt(k, review) {
      var key = norm(k);
      if (!key || strong[key]) return;                 // strong keys always win
      var cur = data.byKey[key];
      if (!cur || (isGeneralTopic(review) && !isGeneralTopic(cur)))
        data.byKey[key] = review;
    }
    // Pass 1: strong keys — slug, id, canonical name, permalink tail.
    reviews.forEach(function (review) {
      [review.slug, review.id, review.canonical_name, permalinkTail(review.permalink)]
        .forEach(function (k) { claim(k, review); });
    });
    // Pass 2: alternate names — only for keys no strong key already took, with
    // the generic-preference tie-break above when two alternates collide.
    reviews.forEach(function (review) {
      (Array.isArray(review.alternate_names) ? review.alternate_names : [])
        .forEach(function (k) { claimAlt(k, review); });
    });
    // Names (for auto matching) + acronym-casing map, from canonical + alternates.
    reviews.forEach(function (review) {
      var humanNames = [review.canonical_name].concat(
        Array.isArray(review.alternate_names) ? review.alternate_names : []);
      humanNames.forEach(function (nm) {
        if (!nm) return;
        data.names.push(nm);
        if (isAcronymName(nm)) {
          var k = norm(nm);
          (data.acronymForms[k] || (data.acronymForms[k] = [])).push(String(nm).trim());
        }
      });
    });
    return data;
  }

  function loadIndex() {
    if (!indexPromise) {
      var url = BASE_URL + "/reviews.json";
      indexPromise = fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error("reviews.json HTTP " + r.status);
          return r.json();
        })
        .then(function (raw) {
          var data = buildIndex(raw);
          log("loaded", Object.keys(data.byKey).length, "review keys from", url);
          return data;
        })
        .catch(function (err) {
          log("failed to load reviews.json:", err.message);
          return { byKey: {}, names: [] }; // fail soft — terms stay un-enhanced
        });
    }
    return indexPromise;
  }

  // ---- card UI (Shadow DOM) -----------------------------------------------

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // First sentence of a conclusion, for the compact hover card. Splits on
  // sentence-ending punctuation followed by whitespace, but skips decimals
  // (3.5) and common abbreviations (e.g., i.e., vs.) so they don't cut short.
  var ABBR = /^(?:e\.g|i\.e|vs|etc|approx|cf|al|Dr|Mr|Mrs|Ms|Prof|Fig)$/i;
  function firstSentence(text) {
    var s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c !== "." && c !== "!" && c !== "?") continue;
      var next = s.charAt(i + 1);
      if (next && next !== " ") continue;            // e.g. "3.5", mid-token dot
      // last word before the mark, minus any leading punctuation like "("
      var lastWord = s.slice(0, i).split(" ").pop().replace(/^[^A-Za-z]+/, "");
      if (ABBR.test(lastWord)) continue;             // known abbreviation
      if (/^[A-Z]$/.test(lastWord)) continue;        // single-letter initial
      return s.slice(0, i + 1);
    }
    return s;
  }

  function createUI() {
    var host = document.createElement("div");
    host.setAttribute("data-evipedia-cardhost", "");
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      "<style>" +
      ":host{all:initial}" +
      ".card{position:absolute;top:0;left:0;width:320px;max-width:calc(100vw - 24px);" +
        "background:#fff;color:#202122;border:1px solid #c8ccd1;border-radius:10px;" +
        "box-shadow:0 6px 24px rgba(0,0,0,.18);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
        "opacity:0;transform:translateY(4px);transition:opacity .13s,transform .13s;pointer-events:none;z-index:2147483647;overflow:hidden}" +
      ".card.on{opacity:1;transform:translateY(0);pointer-events:auto}" +
      ".body{padding:12px 14px 14px}" +
      ".kicker{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#72777d;margin:0 0 4px}" +
      ".title{font-weight:700;font-size:16px;margin:0 0 6px}" +
      ".conclusion{margin:0 0 10px;color:#202122;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}" +
      ".more{color:#3366cc;text-decoration:none;font-weight:600;font-size:13px}" +
      ".more:hover{text-decoration:underline}" +
      "@media (prefers-color-scheme: dark){" +
        ".card{background:#1b1b1b;color:#e6e6e6;border-color:#3a3a3a}" +
        ".kicker{color:#9aa0a6}.conclusion{color:#e6e6e6}.more{color:#7aa7ec}}" +
      "</style>" +
      '<div class="card"><div class="content"></div></div>';

    var card = root.querySelector(".card");
    var content = root.querySelector(".content");
    var hideTimer;

    function position(term) {
      var r = term.getBoundingClientRect();
      var cw = card.offsetWidth, ch = card.offsetHeight, pad = 8;
      // Prefer below the term; flip above if it would overflow the viewport.
      var top = r.bottom + window.scrollY + pad;
      if (r.bottom + ch + pad > window.innerHeight && r.top - ch - pad > 0) {
        top = r.top + window.scrollY - ch - pad;
      }
      var left = r.left + window.scrollX;
      left = Math.max(window.scrollX + 12,
             Math.min(left, window.scrollX + window.innerWidth - cw - 12));
      card.style.top = top + "px";
      card.style.left = left + "px";
    }

    function render(review) {
      content.innerHTML =
        '<div class="body">' +
          '<p class="kicker">evipedia · evidence review</p>' +
          '<p class="title">' + escapeHtml(review.canonical_name) + "</p>" +
          '<p class="conclusion">' + escapeHtml(firstSentence(review.er_conclusion)) + "</p>" +
          '<a class="more" href="' + escapeHtml(reviewUrl(review.permalink)) +
            '" target="_blank" rel="noopener">See the review →</a>' +
        "</div>";
    }

    // Keep the card open while the pointer is inside it.
    card.addEventListener("mouseenter", function () { clearTimeout(hideTimer); });
    card.addEventListener("mouseleave", function () { hideTimer = setTimeout(hide, config.hideDelay); });

    // Touch dismissal: a tap anywhere outside closes the card, while a tap inside
    // it (e.g. the "See the review" link) is preserved — stopPropagation keeps that
    // tap from reaching the document handler, and never blocks the link's default.
    card.addEventListener("click", function (e) { e.stopPropagation(); });
    document.addEventListener("click", function () { hide(); });

    function show(term, review) {
      clearTimeout(hideTimer);
      render(review);
      card.classList.add("on");
      position(term);
    }

    function hide() { card.classList.remove("on"); }

    function scheduleHide() { hideTimer = setTimeout(hide, config.hideDelay); }

    return { show: show, scheduleHide: scheduleHide };
  }

  // ---- term binding & scanning --------------------------------------------

  function bind(term, review) {
    var showTimer;
    term.addEventListener("mouseenter", function () {
      showTimer = setTimeout(function () { ui.show(term, review); }, config.showDelay);
    });
    term.addEventListener("mouseleave", function () {
      clearTimeout(showTimer);
      ui.scheduleHide();
    });
    // Touch devices have no hover — a tap opens the card immediately. stopPropagation
    // keeps the document-level dismiss handler (see createUI) from closing it again.
    term.addEventListener("click", function (e) {
      e.stopPropagation();
      clearTimeout(showTimer);
      ui.show(term, review);
    });
  }

  // Inject the affordance style for matched terms once (minimal & non-invasive:
  // a dotted underline + help cursor, no color change to the host's text).
  function ensureAffordanceStyles() {
    if (document.getElementById("evipedia-widget-style")) return;
    var style = document.createElement("style");
    style.id = "evipedia-widget-style";
    style.textContent =
      ".evipedia-term{text-decoration:underline;text-decoration-style:dotted;" +
      "text-decoration-thickness:1px;text-underline-offset:2px;cursor:help}";
    (document.head || document.documentElement).appendChild(style);
  }

  // Enhance an element so it becomes a hover-card term for `review`.
  function enhance(term, review) {
    term.__evipediaBound = true;
    term.classList.add("evipedia-term");
    bind(term, review);
  }

  // --- manual pass: bind author-marked [data-evipedia] elements ------------
  function manualScan(data) {
    var terms = document.querySelectorAll("[" + ATTR + "]");
    var enhanced = 0;
    Array.prototype.forEach.call(terms, function (term) {
      if (term.__evipediaBound) return;
      var review = data.byKey[norm(term.getAttribute(ATTR))];
      if (!review) { log("no review for", term.getAttribute(ATTR)); return; }
      if (pointsToCurrentPage(review)) { log("skip self-link:", review.canonical_name); return; }
      enhance(term, review);
      enhanced++;
    });
    return enhanced;
  }

  // --- auto pass: scan visible text for known review names -----------------

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Elements whose text we never rewrite (interactive, code, or editable).
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1,
    A: 1, BUTTON: 1, SELECT: 1, OPTION: 1, CODE: 1, PRE: 1, KBD: 1, SAMP: 1 };

  // Build (once, cached on the data object) a single case-insensitive regex of
  // all review names, longest first so multi-word names win over their parts.
  function autoPattern(data) {
    if (data.__pattern !== undefined) return data.__pattern;
    var uniq = {};
    data.names.forEach(function (n) {
      var t = String(n == null ? "" : n).trim();
      // Drop names shorter than the floor, and stop-words entirely (layer 2) —
      // they are never auto-matched, though manual data-evipedia marks still work.
      if (t.length >= config.minAutoLength && !AUTO_STOPWORDS[t.toLowerCase()]) {
        uniq[t.toLowerCase()] = t;
      }
    });
    var list = Object.keys(uniq).map(function (k) { return uniq[k]; });
    list.sort(function (a, b) { return b.length - a.length; });
    data.__pattern = list.length
      ? new RegExp("(^|[^A-Za-z0-9])(" + list.map(escapeRegExp).join("|") + ")(?![A-Za-z0-9])", "gi")
      : null;
    return data.__pattern;
  }

  // Should this text node's content be considered for auto-linking?
  function autoEligible(node) {
    if (!node.nodeValue || !/\S/.test(node.nodeValue)) return false;
    for (var p = node.parentNode; p && p.nodeType === 1; p = p.parentNode) {
      if (SKIP_TAGS[p.tagName]) return false;
      if (p.isContentEditable) return false;
      if (p.classList && p.classList.contains("evipedia-term")) return false;
      if (p.hasAttribute && (p.hasAttribute(ATTR) ||
          p.hasAttribute("data-evipedia-cardhost"))) return false;
    }
    return true;
  }

  // Replace known names inside one text node with bound term spans.
  function autoWrap(node, data, pattern) {
    var text = node.nodeValue;
    pattern.lastIndex = 0;
    var frag = null, last = 0, added = 0, m;
    while ((m = pattern.exec(text))) {
      var name = m[2];
      var start = m.index + m[1].length; // skip the boundary char captured in m[1]
      var key = norm(name);
      // Layer 1: an acronym name only counts in its exact casing, so the ordinary
      // lowercase word ("same", "age", "hit") never links to the supplement,
      // while the real acronym ("SAMe", "AGE", "HIT") does.
      var forms = data.acronymForms[key];
      if (forms && forms.indexOf(name) === -1) continue;
      var review = data.byKey[key];
      if (!review) continue;
      if (pointsToCurrentPage(review)) continue; // don't link a page to itself
      // autoLinkOnce de-dupes on the TERM, not the review: a review referenced by
      // several names (e.g. "Evolocumab" and its brand "Repatha") highlights each
      // distinct word once, rather than only the first-seen surface form.
      if (config.autoLinkOnce && linkedTerms[key]) continue;
      if (!frag) frag = document.createDocumentFragment();
      frag.appendChild(document.createTextNode(text.slice(last, start)));
      var span = document.createElement("span");
      span.setAttribute(ATTR, norm(name));
      span.textContent = name;
      enhance(span, review);
      frag.appendChild(span);
      last = start + name.length;
      added++;
      if (config.autoLinkOnce) linkedTerms[key] = true;
    }
    if (frag) {
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
    return added;
  }

  function autoScan(data) {
    var pattern = autoPattern(data);
    if (!pattern || !document.body) return 0;
    // Collect first — we must not mutate the tree while walking it.
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var nodes = [], node;
    while ((node = walker.nextNode())) if (autoEligible(node)) nodes.push(node);
    var added = 0;
    nodes.forEach(function (n) { added += autoWrap(n, data, pattern); });
    return added;
  }

  // Run the enabled passes. Idempotent and safe to call again after new content
  // is added to the page (SPA / late renders).
  function scan() {
    return loadIndex().then(function (data) {
      var enhanced = manualScan(data);
      if (config.mode === "auto") enhanced += autoScan(data);
      log("enhanced", enhanced, "term(s)");
      return enhanced;
    });
  }

  // ---- public API ---------------------------------------------------------

  function onReady(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  function init(options) {
    config = {};
    for (var k in DEFAULTS) config[k] = DEFAULTS[k];
    if (options) for (var o in options) config[o] = options[o];
    log("init v" + VERSION, config);
    onReady(function () {
      ensureAffordanceStyles();
      if (!ui) ui = createUI();
      scan();
    });
  }

  global.evipedia = global.evipedia || {};
  global.evipedia.init = init;
  global.evipedia.scan = function () { return config ? scan() : Promise.resolve(0); };
  global.evipedia.version = function () { return VERSION; };
})(typeof window !== "undefined" ? window : this);
