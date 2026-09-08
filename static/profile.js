// ?theme=light|dark forces a theme, like the dashboard — for a projector or a screenshot.
(() => {
  const t = new URLSearchParams(window.location.search).get("theme");
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
})();

/* Risk profile editor.
 *
 * Its own page rather than a drawer, because the profile is not a setting —
 * it is the premise. Every number on the radar is conditional on it, and a
 * panel sliding over the radar frames it as a preference.
 *
 * Edits a working copy held in memory and saves it as a new revision. Nothing
 * is written until Save, and Save never overwrites: a score is only meaningful
 * next to the profile that produced it, so revisions stay addressable.
 */

const $ = (id) => document.getElementById(id);

/* Risk profile panel                                                  */
/*                                                                     */
/* Edits a working copy held in memory and saves it as a new revision. */
/* Nothing is written until Save, and Save never overwrites — a score  */
/* is only meaningful next to the profile that produced it, so the     */
/* revisions have to stay addressable.                                 */
/* ------------------------------------------------------------------ */

let PROFILE = null;      // working copy, mutated as fields change
let REVISIONS = [];
let PROFILE_TAB = "identity";

const CRITICALITY = ["high", "medium", "low"];
const TECH_KINDS = ["payment_rail", "market_infrastructure", "core_banking",
                    "cloud", "saas", "data", "database", "ai", "identity",
                    "os", "endpoint", "network", "other"];
// "not stated" is first and is what an untyped control shows, so the editor
// never silently converts an absence into a claim.
const CONTROL_TYPES = ["not stated", "preventive", "detective", "corrective"];
const SCALES = ["high", "medium", "low"];

function elx(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "checked" || k === "selected") { if (v) n[k] = true; }
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) n.append(kid);
  return n;
}

function textField(label, value, onInput, hint) {
  const input = elx("input", { type: "text", value: value ?? "" });
  input.addEventListener("input", () => onInput(input.value));
  return elx("label", { class: "field" }, elx("span", {}, label), input,
             hint ? elx("small", { class: "field-hint" }, hint) : null);
}

function areaField(label, value, onInput, hint) {
  const ta = elx("textarea", {}, value ?? "");
  ta.addEventListener("input", () => onInput(ta.value));
  return elx("label", { class: "field" }, elx("span", {}, label), ta,
             hint ? elx("small", { class: "field-hint" }, hint) : null);
}

function selectField(label, value, options, onInput, hint) {
  const sel = elx("select", {});
  for (const o of options) sel.append(elx("option", { value: o, selected: o === value }, o));
  sel.addEventListener("change", () => onInput(sel.value));
  return elx("label", { class: "field" }, elx("span", {}, label), sel,
             hint ? elx("small", { class: "field-hint" }, hint) : null);
}

function miniSelect(value, options, onInput) {
  const sel = elx("select", {});
  // Profile kinds are intentionally open-ended. A saved profile may introduce
  // a legitimate value before this editor's suggested list catches up. Keep
  // that value visible and selected instead of letting the browser silently
  // display the first option while the underlying profile contains another.
  const choices = options.includes(value) ? options : [value, ...options];
  for (const o of choices) sel.append(elx("option", { value: o, selected: o === value }, o));
  sel.addEventListener("change", () => onInput(sel.value));
  return sel;
}

function miniText(value, placeholder, onInput) {
  const i = elx("input", { type: "text", value: value ?? "", placeholder });
  i.addEventListener("input", () => onInput(i.value));
  return i;
}

function delButton(onClick) {
  return elx("button", { class: "row-del", type: "button", "aria-label": "Remove", onclick: onClick }, "×");
}

function slug(s) {
  return (s || "item").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32)
         || `item_${Math.random().toString(36).slice(2, 7)}`;
}

/* What each tab feeds, and what that dimension is worth. Shown on the page
 * beside the fields, because a form that says only WHAT to type never
 * explains why any of it matters. A block that feeds nothing should not
 * exist; a question with nothing to read cannot be answered.
 */
const FEEDS = {
  identity: [
    ["peer similarity", 0.07, "Weakest of the six on purpose — resemblance is not mechanism."],
    ["regulatory regime", 0.08, "Whether a supervisor's action actually binds us."],
    ["materiality", null, "Ownership and reputation change how badly an event hurts, not whether it could happen."],
  ],
  activities: [
    ["capability exposure", 0.18, "Do we perform the affected activity, and at what scale?"],
  ],
  technology: [
    ["technology & vendor overlap", 0.15, "A failure at a provider we also use transfers almost directly."],
  ],
  vendors: [
    ["technology & vendor overlap", 0.15, "A vendor can fail without its software having a bug."],
  ],
  controls: [
    ["control analogue", 0.22, "Would a control we run have prevented or detected this?"],
  ],
  weaknesses: [
    ["failure mechanism", 0.30, "Heaviest single dimension. Could this sequence occur in our operating model?"],
    ["control analogue", 0.22, "Declared weaknesses are what stop the scoring being uniformly flattering."],
  ],
  history: [],
};

function feedsNote(tab) {
  const rows = FEEDS[tab] || [];
  if (!rows.length) return null;
  const wrap = elx("aside", { class: "feeds" });
  wrap.append(elx("h5", {}, "What this feeds"));
  for (const [name, weight, why] of rows) {
    wrap.append(elx("div", { class: "feed" },
      elx("span", { class: "feed-name" }, name),
      elx("span", { class: "feed-weight" }, weight === null ? "impact axis" : weight.toFixed(2)),
      elx("span", { class: "feed-why" }, why)));
  }
  return wrap;
}

/* ---- tab renderers ---------------------------------------------- */

function tabIdentity(body) {
  const p = PROFILE;
  body.append(
    textField("Name", p.name, (v) => (p.name = v)),
    selectField("Peer class", p.peer_class || "universal",
      ["global_systemic", "universal", "retail", "private_wealth",
       "investment", "infrastructure", "fintech", "non_financial"],
      (v) => (p.peer_class = v),
      "Weakest of the six dimensions on purpose — resemblance is not mechanism."),
    textField("Jurisdictions", (p.jurisdictions || []).join(", "),
      (v) => (p.jurisdictions = v.split(",").map((x) => x.trim()).filter(Boolean))),
    textField("Regulators", (p.regulators || []).join(", "),
      (v) => (p.regulators = v.split(",").map((x) => x.trim()).filter(Boolean))),
  );

  p.scale = p.scale || {};
  for (const [k, label] of [["balance_sheet_band", "Balance sheet"],
                            ["employees_band", "Employees"],
                            ["retail_clients_band", "Retail clients"]]) {
    body.append(textField(label, p.scale[k], (v) => (p.scale[k] = v)));
  }

  p.ownership = p.ownership || { reputation_sensitivity: "medium", state_guarantee: false };
  const o = p.ownership;
  body.append(elx("h4", {}, "Ownership and public exposure"));
  body.append(elx("p", { class: "field-hint" },
    "Feeds materiality, not transferability. Public ownership changes how badly "
    + "an event hurts, not whether it could happen here."));
  body.append(
    selectField("Ownership model", o.model || "public_cantonal",
      ["public_cantonal", "private", "cooperative", "listed"], (v) => (o.model = v)),
    selectField("State guarantee", o.state_guarantee ? "yes" : "no", ["yes", "no"],
      (v) => (o.state_guarantee = v === "yes")),
    textField("Political oversight", o.political_oversight, (v) => (o.political_oversight = v)),
    selectField("Reputation sensitivity", o.reputation_sensitivity || "medium",
      CRITICALITY, (v) => (o.reputation_sensitivity = v)),
    areaField("Why", o.reputation_note, (v) => (o.reputation_note = v),
      "What kind of story would be disproportionately damaging here?"),
  );
}

function tabActivities(body) {
  const p = PROFILE;
  p.activities = p.activities || [];
  body.append(elx("p", { class: "field-hint" },
    "What the bank does. An event landing outside all of these cannot transfer, "
    + "however severe it was elsewhere."));
  const rows = elx("div", { class: "rows" });
  p.activities.forEach((a, i) => {
    rows.append(elx("div", { class: "row row-act" },
      miniText(a.name, "Name", (v) => { a.name = v; a.id = a.id || slug(v); }),
      miniSelect(a.scale || "medium", SCALES, (v) => (a.scale = v)),
      miniText(a.notes, "Notes", (v) => (a.notes = v)),
      delButton(() => { p.activities.splice(i, 1); renderProfileBody(); })));
  });
  body.append(rows, elx("button", { class: "add-row", type: "button",
    onclick: () => { p.activities.push({ id: "", name: "", scale: "medium" }); renderProfileBody(); } },
    "+ activity"));

  body.append(elx("h4", {}, "Explicitly not performed"));
  body.append(elx("p", { class: "field-hint" },
    "The most underrated block here. Absence from the list above is not a statement — "
    + "it is just absence, and a model reading absence guesses. Each line here is a "
    + "whole class of event the radar can confidently discount."));
  p.not_performed = p.not_performed || [];
  const nrows = elx("div", { class: "rows" });
  p.not_performed.forEach((t, i) => {
    nrows.append(elx("div", { class: "row row-text" },
      miniText(t, "e.g. US retail banking", (v) => (p.not_performed[i] = v)),
      delButton(() => { p.not_performed.splice(i, 1); renderProfileBody(); })));
  });
  body.append(nrows, elx("button", { class: "add-row", type: "button",
    onclick: () => { p.not_performed.push(""); renderProfileBody(); } }, "+ not performed"));
}

function tabTechnology(body) {
  const p = PROFILE;
  p.technology = p.technology || [];
  body.append(elx("p", { class: "field-hint" },
    "Untick “used” to state that we do NOT run something. That is what lets "
    + "“a critical Linux CVE was published” resolve to a defensible near-zero "
    + "instead of a guess — the not-used rows are the valuable ones."));
  const rows = elx("div", { class: "rows" });
  p.technology.forEach((t, i) => {
    const used = elx("input", { type: "checkbox", checked: t.used !== false });
    used.addEventListener("change", () => { t.used = used.checked; renderProfileBody(); });
    rows.append(elx("div", { class: `row row-tech${t.used === false ? " is-unused" : ""}` },
      miniText(t.name, "Name", (v) => { t.name = v; t.id = t.id || slug(v); }),
      miniSelect(t.kind || "other", TECH_KINDS, (v) => (t.kind = v)),
      miniSelect(t.criticality || "medium", CRITICALITY, (v) => (t.criticality = v)),
      elx("label", { class: "used-toggle" }, used, "used"),
      delButton(() => { p.technology.splice(i, 1); renderProfileBody(); })));
  });
  body.append(rows, elx("button", { class: "add-row", type: "button",
    onclick: () => { p.technology.push({ id: "", name: "", kind: "other", used: true, criticality: "medium" }); renderProfileBody(); } },
    "+ technology"));
}

function tabVendors(body) {
  const p = PROFILE;
  p.vendors = p.vendors || [];
  body.append(elx("p", { class: "field-hint" },
    "Third parties as distinct from their software — a vendor can fail without a bug. "
    + "Tick concentration where there is no ready substitute; that is where a "
    + "third-party failure becomes an operational one."));
  const rows = elx("div", { class: "rows" });
  p.vendors.forEach((v, i) => {
    const conc = elx("input", { type: "checkbox", checked: !!v.concentration });
    conc.addEventListener("change", () => (v.concentration = conc.checked));
    rows.append(elx("div", { class: "row row-vendor" },
      miniText(v.name, "Vendor", (x) => { v.name = x; v.id = v.id || slug(x); }),
      miniText(v.provides, "What they provide", (x) => (v.provides = x)),
      miniSelect(v.criticality || "medium", CRITICALITY, (x) => (v.criticality = x)),
      elx("label", { class: "used-toggle" }, conc, "sole source"),
      delButton(() => { p.vendors.splice(i, 1); renderProfileBody(); })));
  });
  body.append(rows, elx("button", { class: "add-row", type: "button",
    onclick: () => { p.vendors.push({ id: "", name: "", provides: "", criticality: "medium", concentration: false }); renderProfileBody(); } },
    "+ vendor"));
}

function tabControls(body) {
  const p = PROFILE;
  p.controls = p.controls || [];
  body.append(elx("p", { class: "field-hint" },
    "Scoring runs backwards here on purpose: a control that would have stopped the "
    + "failure LOWERS transferability, and a mechanism nothing covers RAISES it. "
    + "Preventive stops it; detective only catches it afterwards, and scores lower."));
  const rows = elx("div", { class: "rows" });
  p.controls.forEach((c, i) => {
    rows.append(elx("div", { class: "row row-ctrl" },
      miniText(c.name, "Control", (v) => { c.name = v; c.id = c.id || slug(v); }),
      miniSelect(c.type || "not stated", CONTROL_TYPES,
        (v) => (c.type = v === "not stated" ? null : v)),
      miniText((c.covers || []).join(", "), "covers activity ids",
        (v) => (c.covers = v.split(",").map((x) => x.trim()).filter(Boolean))),
      delButton(() => { p.controls.splice(i, 1); renderProfileBody(); })));
  });
  body.append(rows, elx("button", { class: "add-row", type: "button",
    onclick: () => { p.controls.push({ id: "", name: "", type: null, covers: [] }); renderProfileBody(); } },
    "+ control"));
}

function tabWeaknesses(body) {
  const p = PROFILE;
  p.known_weaknesses = p.known_weaknesses || [];
  body.append(elx("p", { class: "field-hint" },
    "Without these, every self-assessment comes back flattering — that is the "
    + "failure mode of the whole exercise. The model cites these directly, so vague "
    + "entries produce vague evidence."));
  const rows = elx("div", { class: "rows" });
  p.known_weaknesses.forEach((w, i) => {
    rows.append(elx("div", { class: "row row-text" },
      miniText(w, "Be specific and slightly uncomfortable", (v) => (p.known_weaknesses[i] = v)),
      delButton(() => { p.known_weaknesses.splice(i, 1); renderProfileBody(); })));
  });
  body.append(rows, elx("button", { class: "add-row", type: "button",
    onclick: () => { p.known_weaknesses.push(""); renderProfileBody(); } }, "+ weakness"));

  body.append(elx("h4", {}, "Operating model"));
  body.append(areaField("", p.operating_model, (v) => (p.operating_model = v),
    "Heaviest single dimension reads mostly this. Write about SHAPE, not size: "
    + "what is centralised, manual, batch, outsourced, a single point of failure."));
}

function tabHistory(body) {
  if (!REVISIONS.length) {
    body.append(elx("p", { class: "field-hint" },
      "No saved revisions yet — the profile is coming from the YAML file on disk."));
    return;
  }
  const ul = elx("ul", { class: "rev-list" });
  for (const r of REVISIONS) {
    ul.append(elx("li", {},
      elx("span", { class: "rev-v" }, `r${r.version}`),
      elx("span", {}, r.note || "no note"),
      elx("span", { class: "rev-when" }, (r.saved_at || "").replace("T", " ").slice(0, 16))));
  }
  body.append(ul);
}

const PROFILE_TABS = {
  identity: tabIdentity, activities: tabActivities, technology: tabTechnology,
  vendors: tabVendors, controls: tabControls, weaknesses: tabWeaknesses,
  history: tabHistory,
};

function renderProfileBody() {
  const body = $("profile-body");
  body.innerHTML = "";
  if (!PROFILE) return;
  const feeds = feedsNote(PROFILE_TAB);
  if (feeds) body.append(feeds);
  (PROFILE_TABS[PROFILE_TAB] || tabIdentity)(body);
  for (const t of document.querySelectorAll("#profile-tabs .tab")) {
    t.classList.toggle("is-active", t.dataset.tab === PROFILE_TAB);
  }
}

function profileStatus(msg, kind = "") {
  const el = $("profile-status");
  el.textContent = msg;
  el.className = "panel-status" + (kind ? ` is-${kind}` : "");
}

async function loadProfile() {
  try {
    const r = await fetch("/api/profile");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    PROFILE = data.profile;
    REVISIONS = data.revisions || [];
    $("profile-source").textContent =
      data.version ? `revision ${data.version} · ${data.source}` : data.source;
    profileStatus("");
    renderProfileBody();
  } catch (err) {
    profileStatus(`Could not load the profile: ${err.message}`, "error");
  }
}

async function saveProfile() {
  const note = $("profile-note").value.trim();
  profileStatus("Saving…");
  try {
    const r = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: PROFILE, note }),
    });
    if (!r.ok) {
      const detail = await r.text();
      throw new Error(detail.slice(0, 200));
    }
    const out = await r.json();
    $("profile-note").value = "";
    profileStatus(
      `Saved as revision ${out.version}. Scores already computed still carry the `
      + `revision they were scored under — re-run the pipeline to update them.`, "ok");
    const again = await (await fetch("/api/profile")).json();
    REVISIONS = again.revisions || [];
    $("profile-source").textContent = `revision ${again.version} · ${again.source}`;
  } catch (err) {
    profileStatus(`Save failed: ${err.message}`, "error");
  }
}

async function resetProfile() {
  try {
    const r = await fetch("/api/profile/seed");
    const data = await r.json();
    PROFILE = data.profile;
    renderProfileBody();
    profileStatus("Loaded the file version. Nothing is saved until you save a revision.");
  } catch (err) {
    profileStatus(`Could not load the file version: ${err.message}`, "error");
  }
}

function initProfilePage() {
  $("profile-save").addEventListener("click", saveProfile);
  $("profile-reset").addEventListener("click", resetProfile);
  $("profile-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    PROFILE_TAB = tab.dataset.tab;
    history.replaceState(null, "", `#${PROFILE_TAB}`);
    renderProfileBody();
  });
  // Deep-link straight to a tab, so a slide or a message can point at one.
  const wanted = location.hash.replace("#", "");
  if (wanted && PROFILE_TABS[wanted]) PROFILE_TAB = wanted;
  loadProfile();
}

initProfilePage();
