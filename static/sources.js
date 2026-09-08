/* Source portfolio editor and ingestion console.
 *
 * The catalog is versioned as a unit. Individual controls edit a working copy;
 * network actions only run after that copy is saved, so a health result always
 * refers to an addressable catalog revision.
 */

(() => {
  const t = new URLSearchParams(window.location.search).get("theme");
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
})();

const $ = (id) => document.getElementById(id);
let DATA = null;
let CATALOG = null;
let DIRTY = false;
let FILTER = "enabled";
let QUERY = "";

const TIERS = ["regulator", "court", "wire", "quality_press", "trade_press", "vendor", "aggregator"];

function node(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "checked" || key === "disabled" || key === "selected") el[key] = Boolean(value);
    else if (value !== null && value !== undefined) el.setAttribute(key, value);
  }
  for (const child of children) if (child !== null && child !== undefined) el.append(child);
  return el;
}

function setStatus(message, kind = "") {
  const out = $("source-status");
  out.textContent = message;
  out.className = `panel-status source-status ${kind ? `is-${kind}` : ""}`;
}

function changed() {
  DIRTY = true;
  setStatus("Unsaved catalog changes.");
}

function slug(value) {
  const clean = (value || "source").toLowerCase().replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "").slice(0, 42);
  return /^[a-z]/.test(clean) ? clean : `source_${clean || Date.now()}`;
}

function pretty(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortDate(value) {
  if (!value) return "—";
  const d = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return Number.isNaN(d.valueOf()) ? value.slice(0, 10) : d.toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function input(value, onInput, attrs = {}) {
  const el = node("input", { type: "text", value: value ?? "", ...attrs });
  el.addEventListener("input", () => { onInput(el.value); changed(); });
  return el;
}

function select(value, options, onChange, attrs = {}) {
  const el = node("select", attrs);
  for (const option of options) {
    el.append(node("option", { value: option, selected: option === value }, pretty(option)));
  }
  el.addEventListener("change", () => { onChange(el.value); changed(); });
  return el;
}

function labeled(label, control, hint = "") {
  return node("label", { class: "source-field" },
    node("span", { text: label }), control,
    hint ? node("small", { text: hint }) : null);
}

function tierDefault(tier) {
  return Number(DATA.tier_defaults[tier] ?? 0.5);
}

function effective(source) {
  return source.credibility === null || source.credibility === undefined
    ? tierDefault(source.tier) : Number(source.credibility);
}

function healthBadge(source) {
  const health = source.health;
  if (!source.enabled) return node("span", { class: "health archived", text: "archived" });
  if (!health) return node("span", { class: "health unchecked", text: "not checked" });
  return node("span", { class: `health ${health.status}`, text: health.status });
}

function renderKpis() {
  const s = DATA.summary;
  const rows = [
    [String(s.enabled), "active sources", `${s.archived} archived`],
    [String(s.articles), "cached articles", "demo-safe, available offline"],
    [`${Math.round(s.regulator_article_share * 100)}%`, "primary-source share", "articles from regulators"],
    [s.weighted_credibility.toFixed(2), "portfolio credibility", "article-weighted score"],
    [String(s.healthy), "healthy feeds", `${s.needs_check} still need a check`],
  ];
  const host = $("source-kpis");
  host.innerHTML = "";
  for (const [value, label, note] of rows) {
    host.append(node("article", { class: "source-kpi" },
      node("strong", { text: value }), node("span", { text: label }), node("small", { text: note })));
  }
}

function renderCoverage() {
  const counts = DATA.summary.categories || {};
  const max = Math.max(1, ...Object.values(counts));
  const host = $("coverage-bars");
  host.innerHTML = "";
  for (const category of DATA.categories) {
    const count = Number(counts[category] || 0);
    host.append(node("div", { class: "coverage-row" },
      node("span", { class: "coverage-name", text: pretty(category) }),
      node("span", { class: "coverage-track" },
        node("i", { style: `width:${Math.round((count / max) * 100)}%` })),
      node("span", { class: "coverage-count", text: String(count) })));
  }
}

function renderDefaults() {
  const host = $("tier-defaults");
  host.innerHTML = "";
  for (const tier of TIERS) {
    host.append(node("div", { class: "tier-default" },
      node("span", { text: pretty(tier) }),
      node("i", { style: `width:${Math.round(tierDefault(tier) * 100)}%` }),
      node("b", { text: tierDefault(tier).toFixed(2) })));
  }
}

function sourceMatches(source) {
  if (FILTER === "enabled" && !source.enabled) return false;
  if (FILTER === "archived" && source.enabled) return false;
  if (FILTER === "needs_check" && (!source.enabled || source.health)) return false;
  const haystack = `${source.id} ${source.name} ${source.url} ${source.category}`.toLowerCase();
  return !QUERY || haystack.includes(QUERY);
}

function credibilityControl(source) {
  const custom = source.credibility !== null && source.credibility !== undefined;
  const value = effective(source);
  const useCustom = node("input", { type: "checkbox", checked: custom });
  const range = node("input", {
    type: "range", min: "0", max: "1", step: "0.05", value: value,
    disabled: !custom, "aria-label": `Credibility for ${source.name}`,
  });
  const out = node("output", { text: value.toFixed(2) });
  const note = input(source.credibility_note || "", (v) => { source.credibility_note = v || null; }, {
    placeholder: "Why does this source differ from its tier?", maxlength: "300", disabled: !custom,
  });

  useCustom.addEventListener("change", () => {
    if (useCustom.checked) source.credibility = effective(source);
    else {
      source.credibility = null;
      source.credibility_note = null;
    }
    changed();
    renderSources();
  });
  range.addEventListener("input", () => {
    source.credibility = Number(range.value);
    out.textContent = Number(range.value).toFixed(2);
    changed();
  });

  return node("div", { class: "credibility-control" },
    node("div", { class: "credibility-head" },
      node("label", { class: "custom-toggle" }, useCustom,
        node("span", { text: custom ? "Custom credibility" : `Tier default (${tierDefault(source.tier).toFixed(2)})` })),
      out),
    range,
    note);
}

async function runCheck(source) {
  if (DIRTY) {
    setStatus("Save the catalog revision before checking a source.", "error");
    return;
  }
  setStatus(`Checking ${source.name}…`);
  const response = await fetch(`/api/sources/${encodeURIComponent(source.id)}/check`, { method: "POST" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus(body.detail || "Source check failed.", "error");
    return;
  }
  await load(`Checked ${source.name}: ${body.message}.`);
}

async function runIngest(source) {
  if (DIRTY) {
    setStatus("Save the catalog revision before ingesting.", "error");
    return;
  }
  setStatus(`Ingesting ${source.name}… this may take a moment.`);
  const response = await fetch(`/api/sources/${encodeURIComponent(source.id)}/ingest`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 50, deep: true }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus(body.detail || "Ingestion failed.", "error");
    return;
  }
  await load(`${source.name}: ${body.entries_seen} entries scanned, ${body.articles_new} new articles cached. Run the pipeline to rank them.`);
}

function sourceCard(source, index) {
  const stats = source.stats || { article_count: 0 };
  const unsaved = Boolean(source._new);
  const card = node("article", { class: `source-card ${source.enabled ? "" : "is-archived"}` });

  const name = input(source.name, (v) => { source.name = v; }, { placeholder: "Source name", maxlength: "100" });
  const id = input(source.id, (v) => { source.id = slug(v); }, {
    placeholder: "stable_source_id", maxlength: "48", disabled: !unsaved,
  });
  const url = input(source.url, (v) => { source.url = v; }, { placeholder: "https://…" });

  const check = node("button", { class: "btn btn-small", type: "button", disabled: unsaved,
    onclick: () => runCheck(source), text: "Check now" });
  const ingest = node("button", { class: "btn btn-small", type: "button",
    disabled: unsaved || !source.enabled, onclick: () => runIngest(source), text: "Ingest" });
  const archive = node("button", { class: "btn btn-small", type: "button",
    onclick: () => {
      if (unsaved && !stats.article_count) CATALOG.sources.splice(index, 1);
      else source.enabled = !source.enabled;
      changed(); renderAll();
    }, text: unsaved && !stats.article_count ? "Remove" : (source.enabled ? "Archive" : "Restore") });

  const health = source.health;
  const healthText = !health ? "No health check recorded"
    : `${health.message || health.status} · ${health.latency_ms ?? "—"} ms · ${shortDate(health.checked_at)}`;

  card.append(
    node("header", { class: "source-card-head" },
      node("div", { class: "source-title" }, healthBadge(source),
        node("strong", { text: source.name || "New source" }),
        node("code", { text: source.id })),
      node("div", { class: "source-card-metrics" },
        node("span", {}, node("b", { text: String(stats.article_count || 0) }), " articles"),
        node("span", {}, "last ", node("b", { text: shortDate(stats.last_article_at) })))),
    node("div", { class: "source-grid" },
      labeled("Display name", name),
      labeled("Stable ID", id, unsaved ? "Immutable after first save." : "Preserves history across renames."),
      labeled("Coverage category", select(source.category, DATA.categories, (v) => { source.category = v; })),
      labeled("Source tier", select(source.tier, TIERS, (v) => { source.tier = v; renderSources(); })),
      labeled("Feed format", select(source.kind, DATA.formats, (v) => { source.kind = v; })),
      labeled("Language", select(source.language, DATA.languages, (v) => { source.language = v; })),
      labeled("Feed URL", url)),
    credibilityControl(source),
    node("footer", { class: "source-card-foot" },
      node("span", { class: "health-detail", text: healthText }),
      node("span", { class: "source-card-spacer" }), check, ingest, archive));
  return card;
}

function renderSources() {
  const host = $("source-list");
  host.innerHTML = "";
  const visible = CATALOG.sources.map((source, index) => ({ source, index }))
    .filter(({ source }) => sourceMatches(source));
  $("catalog-count").textContent = `${visible.length} shown · ${CATALOG.sources.length} configured`;
  if (!visible.length) {
    host.append(node("p", { class: "empty", text: "No sources match this filter." }));
    return;
  }
  for (const { source, index } of visible) host.append(sourceCard(source, index));
}

function renderHistory() {
  const host = $("catalog-history");
  host.innerHTML = "";
  if (!DATA.revisions.length) {
    host.append(node("li", { class: "empty", text: "Using the YAML seed; no UI revisions yet." }));
    return;
  }
  for (const r of DATA.revisions) {
    host.append(node("li", {},
      node("span", { class: "rev-v", text: `v${r.version}` }),
      node("span", { class: "rev-when", text: shortDate(r.saved_at) }),
      node("span", { text: r.note || "no note" })));
  }
}

function renderAll() {
  renderKpis(); renderCoverage(); renderDefaults(); renderSources(); renderHistory();
  $("catalog-meta").innerHTML = "";
  $("catalog-meta").append(node("div", {},
    node("b", { text: DATA.version ? `v${DATA.version}` : "seed" }),
    node("span", { text: DATA.source })));
}

function cleanCatalog() {
  return {
    version: CATALOG.version || 0,
    sources: CATALOG.sources.map((s) => ({
      id: s.id, name: s.name, kind: s.kind, url: s.url, tier: s.tier,
      language: s.language, enabled: s.enabled, category: s.category,
      credibility: s.credibility ?? null, credibility_note: s.credibility_note || null,
    })),
  };
}

async function saveCatalog() {
  const note = $("catalog-note").value.trim();
  setStatus("Validating and saving catalog revision…");
  const response = await fetch("/api/source-catalog", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ catalog: cleanCatalog(), note }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(body.detail)
      ? body.detail.map((x) => `${x.loc?.slice(-1)[0] || "field"}: ${x.msg}`).join("; ")
      : body.detail;
    setStatus(detail || "Could not save the catalog.", "error");
    return;
  }
  $("catalog-note").value = "";
  DIRTY = false;
  await load(`Saved source catalog revision ${body.version}. Run the pipeline to refresh event scores.`);
}

async function resetSeed() {
  const response = await fetch("/api/source-catalog/seed");
  const body = await response.json();
  CATALOG = body.catalog;
  CATALOG.sources.forEach((s) => { s.stats = { article_count: 0 }; s.health = null; });
  DIRTY = true;
  renderAll();
  setStatus("Loaded the YAML seed into the working copy. Save to make it active.");
}

function addSource() {
  const used = new Set(CATALOG.sources.map((s) => s.id));
  let id = "new_source";
  let n = 2;
  while (used.has(id)) id = `new_source_${n++}`;
  CATALOG.sources.unshift({
    id, name: "", kind: "rss", url: "https://", tier: "trade_press",
    language: "en", enabled: true, category: "industry_press",
    credibility: null, credibility_note: null, stats: { article_count: 0 },
    health: null, _new: true,
  });
  FILTER = "all";
  $("source-filter").value = "all";
  DIRTY = true;
  renderAll();
  setStatus("New source added to the working copy. Complete its fields and save.");
}

async function load(message = "") {
  const response = await fetch("/api/source-catalog");
  if (!response.ok) {
    setStatus(`Could not load source catalog (HTTP ${response.status}).`, "error");
    return;
  }
  DATA = await response.json();
  CATALOG = DATA.catalog;
  DIRTY = false;
  renderAll();
  if (message) setStatus(message, "ok");
}

$("source-search").addEventListener("input", (event) => {
  QUERY = event.target.value.trim().toLowerCase(); renderSources();
});
$("source-filter").addEventListener("change", (event) => {
  FILTER = event.target.value; renderSources();
});
$("add-source").addEventListener("click", addSource);
$("catalog-save").addEventListener("click", saveCatalog);
$("catalog-reset").addEventListener("click", resetSeed);

load();
