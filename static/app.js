/* Dashboard. Hand-rolled SVG — no chart library, so the page works offline and
   there is no CDN in the path.

   Three charts, three colour jobs, kept separate:
     radar    identity  -> categorical hues (event type)
     matrix   state     -> the reserved status ramp (severity)
     heatmap  magnitude -> one blue ramp, light to dark
*/

// ?theme=light|dark forces a theme. Useful for a projector, where the room's
// idea of "system dark mode" is nobody's friend, and for printing.
// ?compact=1 strips the evidence lists and rationales from the drawer, leaving
// the six dimensions with their arithmetic. For a projector or a screenshot:
// the full drawer is the right depth to argue from and the wrong density to
// read across a room.
(() => {
  if (new URLSearchParams(window.location.search).get("compact") === "1") {
    document.documentElement.setAttribute("data-compact", "1");
  }
})();

(() => {
  const t = new URLSearchParams(window.location.search).get("theme");
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
})();

const SVG_NS = "http://www.w3.org/2000/svg";
const state = { events: [], summary: null, meta: null, threshold: 0, type: "",
                cat: "", cell: "", cap: "", review: false, disposition: "", sort: "priority", dir: "desc",
                period: "", month: "", asAt: true, top: "", calibration: false,
                page: 1, pageSize: 10 };

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function el(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

// Severity of a matrix cell. Both axes are inverted — 1 and A are worst — so
// the sum of their positions is distance from the danger corner, and the
// reference matrix colours purely on that anti-diagonal.
//
// The bands are read off the reference grid rather than chosen: rank 2-3 red,
// 4 orange, 5 yellow, 6+ green. It has two greens where we have one, which is
// the only difference. An earlier guess at these cutoffs colored eight of the
// sixteen cells one band more severe than the bank's own matrix does — 3B and
// 4A came out orange against a document that calls them yellow.
function severityClass(likelihood, impact) {
  const l = Number(likelihood);
  const i = { A: 1, B: 2, C: 3, D: 4 }[impact] ?? 4;
  const rank = l + i;
  if (rank <= 3) return 1;   // 1A 1B 2A
  if (rank <= 4) return 2;   // 1C 2B 3A
  if (rank <= 5) return 3;   // 1D 2C 3B 4A
  return 4;                  // 2D 3C 4B 3D 4C 4D
}

// Cells inside the escalation boundary drawn on the reference matrix: the
// same rank <= 4 anti-diagonal. Kept as its own function because it is the
// bank's risk appetite, not a rendering detail.
function aboveAppetite(likelihood, impact) {
  const i = { A: 1, B: 2, C: 3, D: 4 }[impact] ?? 4;
  return Number(likelihood) + i <= 4;
}

const TOOLTIP = $("tooltip");
function showTip(evt, title, detail) {
  TOOLTIP.innerHTML = "";
  const b = document.createElement("b");
  b.textContent = title;
  const s = document.createElement("span");
  s.textContent = detail;
  TOOLTIP.append(b, s);
  TOOLTIP.hidden = false;
  const pad = 14;
  const x = Math.min(evt.clientX + pad, window.innerWidth - TOOLTIP.offsetWidth - 8);
  const y = Math.min(evt.clientY + pad, window.innerHeight - TOOLTIP.offsetHeight - 8);
  TOOLTIP.style.left = `${x}px`;
  TOOLTIP.style.top = `${y}px`;
}
const hideTip = () => { TOOLTIP.hidden = true; };

/* ------------------------------------------------------------------ */
/* Radar                                                               */
/* ------------------------------------------------------------------ */

function drawRadar(rows) {
  const svg = $("radar");
  svg.innerHTML = "";
  const spokes = rows.filter((r) => r.count > 0);
  if (!spokes.length) return;

  const W = 660, H = 440, cx = W / 2, cy = H / 2 + 4, R = 126;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  const max = Math.max(...spokes.map((r) => r.priority)) || 1;
  const n = spokes.length;
  const angle = (i) => (i / n) * Math.PI * 2 - Math.PI / 2;

  // Rings, recessive.
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    svg.appendChild(el("circle", {
      cx, cy, r: R * frac, fill: "none",
      stroke: css("--grid"), "stroke-width": 1,
    }));
  }

  spokes.forEach((row, i) => {
    const a = angle(i);
    svg.appendChild(el("line", {
      x1: cx, y1: cy, x2: cx + Math.cos(a) * R, y2: cy + Math.sin(a) * R,
      stroke: css("--grid"), "stroke-width": 1,
    }));
  });

  // The shape itself.
  const pts = spokes.map((row, i) => {
    const a = angle(i);
    const r = (row.priority / max) * R;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  svg.appendChild(el("polygon", {
    points: pts.map((p) => p.join(",")).join(" "),
    fill: css("--type-incident"), "fill-opacity": 0.16,
    stroke: css("--type-incident"), "stroke-width": 2,
    "stroke-linejoin": "round",
  }));

  // Markers, >=8px, with a surface ring so overlaps stay readable.
  pts.forEach(([x, y], i) => {
    const row = spokes[i];
    const selected = state.cat === row.category;
    const dot = el("circle", {
      cx: x, cy: y, r: selected ? 6 : 4.5,
      fill: css("--type-incident"),
      // Selected takes the text colour for its ring, as the other two charts
      // do. The surface ring is there to keep overlapping markers readable, so
      // swapping it rather than adding a third circle keeps that job intact.
      stroke: selected ? css("--text-primary") : css("--surface-1"),
      "stroke-width": 2,
    });
    dot.style.cursor = "pointer";
    dot.addEventListener("mousemove", (e) =>
      showTip(e, row.category,
        `${row.count} events · priority ${row.priority.toFixed(2)}\n` +
        (selected ? "click to clear this filter" : "click to filter the list to this category")));
    dot.addEventListener("mouseleave", hideTip);
    dot.addEventListener("click", () => selectCategory(selected ? "" : row.category));
    svg.appendChild(dot);
  });

  // Direct labels — required relief for the low-contrast slot, and they make
  // the chart readable without a legend lookup.
  spokes.forEach((row, i) => {
    const a = angle(i);
    const lx = cx + Math.cos(a) * (R + 16);
    const ly = cy + Math.sin(a) * (R + 16);
    const anchor = Math.abs(Math.cos(a)) < 0.25 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
    const selected = state.cat === row.category;
    // Two lines beat one clipped line: the category name is the label's whole job.
    const words = row.category.replace(/\s*\(.*\)/, "").split(" ");
    const lines = words.length > 2
      ? [words.slice(0, 2).join(" "), words.slice(2).join(" ")]
      : [words.join(" ")];
    lines.forEach((line, k) => {
      // The label is a click target too. It is the larger one and the one a
      // reader actually aims at — the marker is 9px across and can sit on top
      // of a neighbour near the centre, where several short spokes converge.
      const label = el("text", {
        x: lx, y: ly + 3 + k * 11 - (lines.length - 1) * 5.5, "text-anchor": anchor,
        "font-size": 9.5, "font-family": "ui-monospace, monospace",
        fill: css(selected ? "--text-primary" : "--muted"),
      }, line);
      label.style.cursor = "pointer";
      label.addEventListener("click", () => selectCategory(selected ? "" : row.category));
      svg.appendChild(label);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Calibration                                                         */
/*                                                                     */
/* The diagonal is a perfect model. A point above it means the score    */
/* under-called those events; below, it over-called them. A bin with    */
/* no observations is drawn as a GAP, never as zero — zero would read   */
/* as "none of these were relevant", which is a claim we have not       */
/* earned. Thin bins are hollow so a two-point band cannot be mistaken  */
/* for a measured one.                                                  */
/* ------------------------------------------------------------------ */

function drawCalibration(cal) {
  const svg = $("calibration");
  svg.innerHTML = "";
  $("calib-verdict").textContent = cal.verdict;
  $("calib-verdict").classList.toggle("is-thin", !cal.enough);

  const W = 640, H = 300, pad = 46;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const x = (v) => pad + v * (W - pad * 2);
  const y = (v) => H - pad - v * (H - pad * 2);

  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    svg.appendChild(el("line", { x1: pad, y1: y(t), x2: W - pad, y2: y(t),
      stroke: css("--grid"), "stroke-width": 1 }));
    svg.appendChild(el("text", { x: pad - 8, y: y(t) + 3, "text-anchor": "end",
      "font-size": 9.5, "font-family": "ui-monospace, monospace",
      fill: css("--muted") }, `${Math.round(t * 100)}%`));
    svg.appendChild(el("text", { x: x(t), y: H - pad + 16, "text-anchor": "middle",
      "font-size": 9.5, "font-family": "ui-monospace, monospace",
      fill: css("--muted") }, t.toFixed(2)));
  }

  // Perfect calibration. Everything is read against this line.
  svg.appendChild(el("line", { x1: x(0), y1: y(0), x2: x(1), y2: y(1),
    stroke: css("--appetite-line"), "stroke-width": 1.5, "stroke-dasharray": "4 4" }));
  svg.appendChild(el("text", { x: x(0.72), y: y(0.78), "font-size": 9.5,
    "font-family": "ui-monospace, monospace", fill: css("--muted") },
    "perfectly calibrated"));

  // The threshold, because the score's job is deciding who gets asked.
  svg.appendChild(el("line", { x1: x(cal.threshold), y1: y(0), x2: x(cal.threshold), y2: y(1),
    stroke: css("--serious"), "stroke-width": 1, "stroke-dasharray": "2 3" }));

  svg.appendChild(el("text", { x: W / 2, y: H - 8, "text-anchor": "middle",
    "font-size": 10, "font-family": "ui-monospace, monospace", fill: css("--muted") },
    "predicted transferability"));

  const measured = cal.bins.filter((b) => b.observed !== null);
  if (!measured.length) return;

  let prev = null;
  for (const b of measured) {
    const cx = x(b.predicted), cy = y(b.observed);
    if (prev) {
      svg.appendChild(el("line", { x1: prev[0], y1: prev[1], x2: cx, y2: cy,
        stroke: css("--type-incident"), "stroke-width": 2 }));
    }
    prev = [cx, cy];
    const dot = el("circle", { cx, cy, r: 5,
      fill: b.thin ? css("--surface-1") : css("--type-incident"),
      stroke: css("--type-incident"), "stroke-width": 2 });
    dot.style.cursor = "pointer";
    dot.addEventListener("mousemove", (ev) => showTip(ev,
      `predicted ${b.predicted.toFixed(2)}`,
      `${Math.round(b.observed * 100)}% relevant · ${b.n} judgement${b.n === 1 ? "" : "s"}` +
      (b.thin ? " — too few to read" : "")));
    dot.addEventListener("mouseleave", hideTip);
    svg.appendChild(dot);
  }
}

/* ------------------------------------------------------------------ */
/* Risk matrix                                                         */
/* ------------------------------------------------------------------ */

function drawMatrix(cells) {
  const svg = $("matrix");
  svg.innerHTML = "";
  const W = 460, H = 380;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  // Both orders are taken from the reference matrix: impact least-severe on
  // the left, likelihood MOST severe at the top, so the danger corner is top
  // right. Reading it the intuitive way round puts 1A at the bottom and makes
  // the picture disagree with the one the risk team already has on the wall.
  const impacts = ["D", "C", "B", "A"];       // Tief -> Sehr Hoch, left to right
  const likelihoods = ["1", "2", "3", "4"];   // Sehr Hoch -> Tief, top to bottom
  const left = 58, top = 44, cw = 88, ch = 68, gap = 2;

  const lookup = new Map(cells.map((c) => [`${c.likelihood}${c.impact}`, c]));
  const maxCount = Math.max(1, ...cells.map((c) => c.count));

  likelihoods.forEach((lk, r) => {
    impacts.forEach((im, c) => {
      const x = left + c * cw;
      const y = top + r * ch;
      const sev = severityClass(lk, im);
      const fill = [null, css("--critical"), css("--serious"), css("--warning"), css("--good")][sev];
      const cell = lookup.get(`${lk}${im}`);
      const count = cell ? cell.count : 0;

      svg.appendChild(el("rect", {
        x, y, width: cw - gap, height: ch - gap, rx: 3,
        fill, "fill-opacity": count ? 0.30 + 0.5 * (count / maxCount) : 0.10,
        stroke: css("--surface-1"), "stroke-width": 2,
      }));

      if (count) {
        svg.appendChild(el("text", {
          x: x + (cw - gap) / 2, y: y + (ch - gap) / 2 + 6, "text-anchor": "middle",
          "font-size": 17, "font-weight": 600, "font-family": "ui-monospace, monospace",
          fill: css("--text-primary"),
        }, String(count)));
      }

      // The cell currently filtering the table, outlined rather than recoloured
      // — the fill already encodes severity and a second meaning on the same
      // channel would make the grid unreadable.
      const selected = state.cell === `${lk}${im}`;
      if (selected) {
        svg.appendChild(el("rect", {
          x: x + 1.5, y: y + 1.5, width: cw - gap - 3, height: ch - gap - 3, rx: 2,
          fill: "none", stroke: css("--text-primary"), "stroke-width": 2,
        }));
      }

      const hit = el("rect", { x, y, width: cw - gap, height: ch - gap, fill: "transparent" });
      hit.style.cursor = count ? "pointer" : "default";
      hit.addEventListener("mousemove", (e) =>
        showTip(e, `Cell ${lk}${im}`,
          `${count} event${count === 1 ? "" : "s"} · likelihood ${lk}, impact ${im}` +
          (count ? (selected ? "\nclick to clear this filter" : "\nclick to filter the list to this cell") : "")));
      hit.addEventListener("mouseleave", hideTip);
      // Only an occupied cell filters. Clicking an empty one would replace the
      // list with "no events match", which reads as a broken filter rather than
      // as the empty cell the reader just pointed at.
      if (count) {
        hit.addEventListener("click", () => selectCell(selected ? "" : `${lk}${im}`));
      }
      svg.appendChild(hit);
    });
  });

  // The escalation boundary drawn on the reference matrix. Everything enclosed
  // sits above the bank's stated risk appetite, so the line is the point of the
  // whole picture: it says which cells someone has to act on rather than note.
  // Traced as a staircase over the same rank <= 4 cells the reference outlines.
  const bx = (c) => left + c * cw - gap / 2;
  const by = (r) => top + r * ch - gap / 2;
  const corners = [[1, 0], [4, 0], [4, 3], [3, 3], [3, 2], [2, 2], [2, 1], [1, 1]];
  svg.appendChild(el("path", {
    d: corners.map(([c, r], k) => `${k ? "L" : "M"}${bx(c)} ${by(r)}`).join(" ") + " Z",
    fill: "none", stroke: css("--appetite-line"), "stroke-width": 2.5,
    "stroke-linejoin": "round",
  }));
  svg.appendChild(el("text", {
    x: bx(4), y: by(4) + 20, "text-anchor": "end",
    "font-size": 9, "font-family": "ui-monospace, monospace", fill: css("--appetite-line"),
  }, "\u2500\u2500 ESCALATION THRESHOLD"));

  // Axes, labelled in the matrix's own terms.
  impacts.forEach((im, c) => {
    svg.appendChild(el("text", {
      x: left + c * cw + (cw - gap) / 2, y: top - 12, "text-anchor": "middle",
      "font-size": 11, "font-family": "ui-monospace, monospace", fill: css("--text-secondary"),
    }, im));
  });
  likelihoods.forEach((lk, r) => {
    svg.appendChild(el("text", {
      x: left - 12, y: top + r * ch + (ch - gap) / 2 + 4, "text-anchor": "end",
      "font-size": 11, "font-family": "ui-monospace, monospace", fill: css("--text-secondary"),
    }, lk));
  });
  svg.appendChild(el("text", {
    x: left + 2 * cw, y: top - 28, "text-anchor": "middle",
    "font-size": 10, "font-family": "ui-monospace, monospace", fill: css("--muted"),
  }, "IMPACT  (A = > CHF 100m)"));
  svg.appendChild(el("text", {
    x: 16, y: top + 2 * ch, "text-anchor": "middle",
    transform: `rotate(-90 16 ${top + 2 * ch})`,
    "font-size": 10, "font-family": "ui-monospace, monospace", fill: css("--muted"),
  }, "LIKELIHOOD  (1 = most frequent)"));
}

/* ------------------------------------------------------------------ */
/* Heatmap                                                             */
/* ------------------------------------------------------------------ */

function drawHeatmap(summary) {
  const svg = $("heatmap");
  svg.innerHTML = "";

  const counts = new Map(summary.heatmap.map((h) => [`${h.category}|||${h.capability}`, h.count]));
  const cats = summary.categories.filter((c) =>
    summary.heatmap.some((h) => h.category === c));
  const caps = summary.capabilities.filter((c) =>
    summary.heatmap.some((h) => h.capability === c));
  if (!cats.length || !caps.length) return;

  const cw = 34, ch = 26, left = 210, top = 116, gap = 2;
  const W = left + caps.length * cw + 20;
  const H = top + cats.length * ch + 24;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W);

  const max = Math.max(1, ...counts.values());
  const ramp = ["--seq-100", "--seq-200", "--seq-300", "--seq-400", "--seq-500", "--seq-600", "--seq-700"].map(css);
  const colourFor = (n) => n === 0 ? null : ramp[Math.min(ramp.length - 1, Math.floor((n / max) * (ramp.length - 1) + 0.5))];

  caps.forEach((cap, c) => {
    const x = left + c * cw + (cw - gap) / 2;
    svg.appendChild(el("text", {
      x, y: top - 10, "text-anchor": "start", transform: `rotate(-55 ${x} ${top - 10})`,
      "font-size": 9.5, "font-family": "ui-monospace, monospace", fill: css("--text-secondary"),
    }, cap.length > 22 ? cap.slice(0, 20) + "…" : cap));
  });

  cats.forEach((cat, r) => {
    svg.appendChild(el("text", {
      x: left - 10, y: top + r * ch + ch / 2 + 3, "text-anchor": "end",
      "font-size": 9.5, "font-family": "ui-monospace, monospace", fill: css("--text-secondary"),
    }, cat.length > 30 ? cat.slice(0, 28) + "…" : cat));

    caps.forEach((cap, c) => {
      const n = counts.get(`${cat}|||${cap}`) || 0;
      const x = left + c * cw, y = top + r * ch;
      const fill = colourFor(n);
      const selected = state.cap === cap && state.cat === cat;
      svg.appendChild(el("rect", {
        x, y, width: cw - gap, height: ch - gap, rx: 2,
        fill: fill || "transparent",
        // Selection is an outline in the text colour. The fill is the sequential
        // ramp and already means "how many"; a second meaning on it would make
        // a selected sparse cell read as a busy one.
        stroke: selected ? css("--text-primary")
          : fill ? css("--surface-1") : css("--grid"),
        "stroke-width": selected ? 2 : fill ? 2 : 1,
      }));
      if (n > 0) {
        const hit = el("rect", { x, y, width: cw - gap, height: ch - gap, fill: "transparent" });
        hit.style.cursor = "pointer";
        hit.addEventListener("mousemove", (e) => showTip(e, `${cat} → ${cap}`,
          `${n} event${n === 1 ? "" : "s"}\n` +
          (selected ? "click to clear this filter" : "click to filter the list to this pair")));
        hit.addEventListener("mouseleave", hideTip);
        // An empty cell stays inert, as on the matrix: filtering to one would
        // replace the list with "no events match", which reads as a broken
        // filter rather than as the empty cell the reader just pointed at.
        hit.addEventListener("click", () =>
          selected ? selectHeat("", "") : selectHeat(cat, cap));
        svg.appendChild(hit);
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* Table + drawer                                                      */
/* ------------------------------------------------------------------ */

// An abstention is not a low score. The model said it could not answer the
// question, and burying that at the bottom of the same ranked list is the one
// reading it must not get — so it is filterable on its own.
// "open" is its own option rather than a seventh state, because "what is
// still on my desk" is the question an analyst asks most and it spans two
// states. Everything else matches exactly.
function matchesDisposition(e) {
  if (!state.disposition) return true;
  if (state.disposition === "open") return e.is_open;
  return e.disposition === state.disposition;
}

function visibleEvents() {
  const rows = state.events.filter((e) =>
    (e.transferability ?? 0) >= state.threshold &&
    (!state.type || e.event_type === state.type) &&
    (!state.cat || (e.orx_l1 || "") === state.cat) &&
    // The matrix cell, when one has been clicked. An unplaced event has no
    // cell, so it is excluded from every cell filter rather than matching the
    // empty one.
    (!state.cell || `${e.likelihood ?? ""}${e.impact ?? ""}` === state.cell) &&
    // The capability a heatmap cell names. An event touches several, so this
    // asks whether the clicked one is among them rather than whether it is the
    // only one — a cross-unit event belongs in every cell it appears in.
    (!state.cap || e.capabilities.some((c) => c.name === state.cap)) &&
    (!state.review || e.abstained) &&
    matchesDisposition(e));
  const sorted = sortEvents(rows);
  const cap = Number(state.top);
  return cap ? sorted.slice(0, cap) : sorted;
}

// How to order by each column. Severity is the one that cannot be done on the
// displayed value: the cell reads "3A", and sorting those as text puts 1D above
// 2A — when 2A is far worse. Both axes are inverted and severity runs along the
// anti-diagonal, so it has to sort on the same rank the colour bands use.
const SORT_KEY = {
  priority:        (e) => e.priority ?? 0,
  transferability: (e) => e.transferability ?? 0,
  sources:         (e) => e.article_count ?? 0,
  reported:        (e) => e.reported_on || "",
  severity:        (e) => {
    const l = Number(e.likelihood);
    const i = { A: 1, B: 2, C: 3, D: 4 }[e.impact];
    // Unplaced events sort last in either direction rather than masquerading
    // as the least severe thing on the board.
    if (!l || !i) return null;
    return -(l + i);   // negated so "descending" means most severe first
  },
};

function sortEvents(rows) {
  const key = SORT_KEY[state.sort] || SORT_KEY.priority;
  const sign = state.dir === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = key(a), bv = key(b);
    if (av === null || av === "") return 1;      // unknowns always at the bottom
    if (bv === null || bv === "") return -1;
    if (av === bv) return (b.priority ?? 0) - (a.priority ?? 0);  // stable tiebreak
    return av > bv ? sign : -sign;
  });
}

// Clicking a chart filters the list to what was clicked. Both charts already
// answered "how many"; the question neither could answer was "which ones", and
// that was a click nobody could make.
//
// One function for both, because the follow-through is identical — reset to
// page 1, put it in the URL, redraw the chart so the selection moves, rerender
// the list, and take the reader to it. Two copies of that would drift.
function applyChartFilter(changes, focus = true) {
  Object.assign(state, changes);
  state.page = 1;
  syncUrl();
  drawRadar(state.summary.radar);
  drawMatrix(state.summary.matrix);
  drawHeatmap(state.summary);
  $("cat-filter").value = state.cat;
  renderTable();
  if (focus) $("event-table").scrollIntoView({ behavior: "smooth", block: "center" });
}

const selectCell = (cell) => applyChartFilter({ cell }, Boolean(cell));

// A radar spoke is one category — the same filter the dropdown sets, which is
// why it needs no chip and no URL parameter of its own. It drops any pinned
// capability for the same reason the dropdown does: category and capability
// together name a heatmap cell, and changing half of it asks for a pair nobody
// pointed at.
const selectCategory = (cat, focus = Boolean(cat)) =>
  applyChartFilter({ cat, cap: "" }, focus);

// The heatmap cell is a PAIR — this category, in this capability — so clicking
// one sets both. Setting only the category would show events the cell does not
// contain, which is the opposite of what pointing at a cell asks for.
const selectHeat = (cat, cap) => applyChartFilter({ cat, cap }, Boolean(cap));

function renderFilterChips() {
  const box = $("filter-chips");
  box.innerHTML = "";
  // Category alone gets no chip: the dropdown above already shows it. Only
  // filters with no visible control of their own need one.
  const chips = [];
  if (state.cell) chips.push({ clears: { cell: "" }, label: `Cell ${state.cell}` });
  if (state.cap) chips.push({ clears: { cat: "", cap: "" }, label: `${state.cat || "any"} → ${state.cap}` });

  for (const chip of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip";
    button.setAttribute("aria-label", `Clear the ${chip.label} filter`);
    button.innerHTML = `<span class="filter-chip-label"></span><span class="filter-chip-x" aria-hidden="true">&times;</span>`;
    button.querySelector(".filter-chip-label").textContent = chip.label;
    button.addEventListener("click", () => applyChartFilter(chip.clears, false));
    box.appendChild(button);
  }
}

function renderTable() {
  const body = $("event-body");
  body.innerHTML = "";
  renderFilterChips();
  renderSortIndicators();
  const rows = visibleEvents();
  const pageCount = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(Math.max(1, state.page), pageCount);
  const start = rows.length ? (state.page - 1) * state.pageSize : 0;
  const end = Math.min(start + state.pageSize, rows.length);
  $("page-size").value = String(state.pageSize);
  $("event-count").textContent = `${rows.length ? start + 1 : 0}\u2013${end} of ${rows.length}`;
  $("page-prev").disabled = state.page <= 1;
  $("page-next").disabled = state.page >= pageCount;

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 9; td.className = "empty";
    // An empty corpus and an over-tight filter look identical on screen and
    // need completely different responses. A fresh clone has no data/ — it is
    // gitignored — so the first thing anyone sees is this cell, and telling
    // them "no events match the current filters" sends them to fiddle with a
    // slider that was never the problem.
    if (!state.events.length) {
      td.innerHTML = `<b>No corpus yet.</b> Nothing has been ingested into this
        store. Build one with <code>python run.py ingest</code>, then
        <code>python run.py pipeline</code>. Articles are cached permanently,
        so this is a one-time network step.`;
    } else if (state.review) {
      td.textContent = "Nothing is waiting on review — every event was scored.";
    } else {
      td.textContent = "No events match the current filters.";
    }
    tr.appendChild(td); body.appendChild(tr);
    return;
  }

  for (const e of rows.slice(start, end)) {
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    const sev = severityClass(e.likelihood, e.impact);
    const owners = e.capabilities.slice(0, 2).map((c) => c.name).join(", ") || "—";
    tr.innerHTML = `
      <td class="num">${e.priority.toFixed(3)}</td>
      <td><span class="pill ${e.event_type}">${e.event_type.replace("_", " ")}</span></td>
      <td>${escapeHtml(e.title).slice(0, 90)}</td>
      <td>${escapeHtml(e.orx_l1 || "—")}</td>
      <td><span class="cell-badge sev-${sev}">${e.likelihood ?? "?"}${e.impact ?? "?"}</span></td>
      <td class="num">${(e.transferability ?? 0).toFixed(2)}</td>
      <td class="when">${e.reported_on || "—"}</td>
      <td class="owners">${escapeHtml(owners)}${e.cross_unit ? ' <span class="cross">↗ monthly</span>' : ""}</td>
      <td class="num">${e.article_count}</td>`;
    tr.addEventListener("click", () => openDrawer(e.event_id));
    tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter") openDrawer(e.event_id); });
    body.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Provenance is part of the record, not something this file reconstructs. Every
// value either quotes the sentence it was read from or says it was inferred; a
// field that does neither is a bug, and it is shown as one rather than hidden.
const FIELD_LABEL = {
  institution: "Institution", occurred_on: "Date", loss_amount: "Loss amount",
  peer_class: "Peer class", country: "Country", regulator: "Regulator",
  effective_on: "Effective date", technology: "Technology",
  maturity: "Maturity", horizon_years: "Horizon",
};
const fieldLabel = (f) => FIELD_LABEL[f] || f.replace(/_/g, " ");

// Public attention, as a chip rather than an icon in the list. An icon beside
// a row is a claim standing away from its evidence; here it sits next to the
// other decomposed scores, and it shows its own components — including the one
// weighing nothing. That component IS the honesty: there is no social feed
// connected, so it contributes zero and says so, rather than a number nobody
// could defend.
function attentionChip(a) {
  if (!a) return "";
  const dormant = a.components.filter((c) => c.weight === 0);
  const live = a.components.filter((c) => c.weight > 0);
  const parts = live.map((c) =>
    `<div class="att-part">
       <span class="att-name">${escapeHtml(c.name.replace(/_/g, " "))}</span>
       <span class="att-num">${c.score.toFixed(2)} × ${c.weight.toFixed(2)} = ${c.contribution.toFixed(3)}</span>
       <span class="att-detail">${escapeHtml(c.detail)}</span>
     </div>`).join("");
  const inert = dormant.map((c) =>
    `<div class="att-part is-dormant">
       <span class="att-name">${escapeHtml(c.name.replace(/_/g, " "))}</span>
       <span class="att-num">not connected · weight 0</span>
       <span class="att-detail">${escapeHtml(c.detail)}</span>
     </div>`).join("");

  return `
    <h4>Public attention
      <span class="att-chip att-${a.band}">${a.band} · ${a.score.toFixed(2)}</span>
    </h4>
    <p class="att-lede">Feeds the qualitative impact axis, gated by the profile's
      declared reputational sensitivity — attention changes how badly an event
      would hurt, not whether it could happen here.</p>
    <div class="att-parts">${parts}${inert}</div>`;
}

function provenanceBlock(e) {
  const cited = Object.entries(e.citations || {});
  const inferred = e.inferred_fields || [];
  const missing = e.unprovenanced_fields || [];
  if (!cited.length && !inferred.length && !missing.length) {
    return '<p class="empty">No extracted values on this event.</p>';
  }

  const quotes = cited.map(([field, c]) => `
    <div class="cite">
      <span class="cite-field">${escapeHtml(fieldLabel(field))}</span>
      <blockquote>${escapeHtml(c.quote)}</blockquote>
      ${c.url ? `<a class="cite-src" href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">source</a>` : ""}
    </div>`).join("");

  const inferredRow = inferred.length
    ? `<p class="inferred-note"><b>Inferred, not quoted:</b>
       ${inferred.map((f) => escapeHtml(fieldLabel(f))).join(", ")}. These were
       derived by the system rather than read from a sentence.</p>`
    : "";

  const missingRow = missing.length
    ? `<p class="unprovenanced"><b>Unsourced:</b>
       ${missing.map((f) => escapeHtml(fieldLabel(f))).join(", ")}. These carry a
       value that cites nothing and was not marked inferred — treat as unreliable
       and report it.</p>`
    : "";

  return quotes + inferredRow + missingRow;
}

// What we did about it, as distinct from what the business unit said. The two
// are separate questions and the drawer keeps them apart.
const DISPOSITIONS = [
  ["new", "New"], ["in_review", "In review"], ["actioned", "Actioned"],
  ["closed", "Closed"], ["not_relevant", "Not relevant"],
  ["accepted_risk", "Accepted risk"],
];

function dispositionBlock(e) {
  const buttons = DISPOSITIONS.map(([v, label]) => `
    <button class="disp-btn" data-disp="${v}" aria-pressed="${e.disposition === v}">
      ${escapeHtml(label)}</button>`).join("");
  return `<div class="disp" data-current="${escapeHtml(e.disposition || "new")}">
    ${buttons}
    ${e.assigned_to ? `<span class="disp-owner">assigned: ${escapeHtml(e.assigned_to)}</span>` : ""}
  </div>`;
}

// Nothing here is editable after the fact. The value of an audit trail is that
// it cannot be tidied up afterwards, so notes append and history is read-only.
const KIND_LABEL = {
  note: "note", disposition: "status", assignment: "assigned",
  consultation: "consulted", relevance: "relevance", classification: "category",
};

function historyBlock(rows) {
  if (!rows || !rows.length) {
    return '<p class="empty">Nothing recorded yet.</p>';
  }
  return `<ol class="history">${rows.map((h) => {
    const when = (h.decided_at || "").replace("T", " ").slice(0, 16);
    const changed = h.model_said && h.model_said !== h.verdict
      ? `<span class="hist-was">was ${escapeHtml(h.model_said)}</span>` : "";
    return `<li>
      <span class="hist-kind">${escapeHtml(KIND_LABEL[h.kind] || h.kind)}</span>
      <span class="hist-verdict">${escapeHtml(h.verdict)}</span>
      ${changed}
      ${h.note ? `<span class="hist-note">${escapeHtml(h.note)}</span>` : ""}
      <span class="hist-meta">${escapeHtml(h.decided_by || "unknown")} · ${escapeHtml(when)}</span>
    </li>`;
  }).join("")}</ol>`;
}

// The category the analyst can disagree with. Correcting it APPLIES — the radar
// should show what the bank believes, not what the model guessed — while the
// model's own answer stays on the event and stays visible, because that pair is
// the evaluation set and overwriting it would destroy what the correction
// produced.
function categoryBlock(e) {
  const cats = (state.summary?.categories || []).filter((c) => c !== "unclassified");
  const current = e.orx_l1 || "";
  const options = ['<option value="">— choose a category —</option>']
    .concat(cats.map((c) =>
      `<option value="${escapeHtml(c)}"${c === current ? " selected" : ""}>${escapeHtml(c)}</option>`))
    .join("");
  const wasCorrected = e.orx_corrected && e.orx_model_said && e.orx_model_said !== current;
  return `
    <div class="classify">
      <select id="cat-correct" aria-label="Risk category">${options}</select>
      <button class="btn" id="cat-save">Confirm</button>
      ${wasCorrected
        ? `<span class="classify-was">model said ${escapeHtml(e.orx_model_said)}</span>`
        : ""}
    </div>
    <p class="field-hint">Confirming agreement is recorded too — an agreement rate
    computed only from corrections measures nothing.</p>`;
}

// "Is this already covered by a risk we assessed?" — the second question after
// "could this happen here". An exact match and a broader one are labelled
// differently, because telling an analyst something is covered when it is not
// costs the event, and a register that distinguishes payments fraud from
// trading fraud should not be told they are the same.
function coverageBlock(cov) {
  if (!cov || !cov.configured) {
    return `<p class="empty">No risk register configured — whether this is already
      covered has not been asked. Point <code>config/risk_register.yaml</code> at
      yours to answer it.</p>`;
  }
  if (!cov.entries.length) {
    return '<p class="empty">No entry in the register covers this category and capability.</p>';
  }
  return `<ul class="coverage">${cov.entries.map((e) => {
    const stale = e.days_since_assessed !== null && e.days_since_assessed > 365;
    return `<li>
      <span class="cov-id">${escapeHtml(e.id)}</span>
      <span class="cov-how cov-${e.how}">${e.how === "exact" ? "exact" : "category only"}</span>
      <span class="cov-title">${escapeHtml(e.title)}</span>
      ${e.status !== "open" ? `<span class="cov-status">${escapeHtml(e.status)}</span>` : ""}
      <span class="cov-meta">${escapeHtml(e.owner || "unowned")}${
        e.last_assessed ? ` · assessed ${escapeHtml(e.last_assessed)}` : ""
      }${stale ? " · over a year ago" : ""}</span>
    </li>`;
  }).join("")}</ul>`;
}

// How firmly this event sits in its likelihood band.
//
// The matrix cell is a verdict with no error bars, and the first thing anyone
// challenging a placement asks is "what would it take to move it". That has an
// exact answer, so it is shown as one — a required value per input, not a
// hedge. The probability of being in a different band is a separate claim that
// needs measured error, so it appears only once enough consultations exist and
// says what is missing until then.
function bandMarginBlock(e) {
  const m = e.band_margin;
  if (!m) return '<p class="empty">Not scored, so there is no band to be near the edge of.</p>';

  const pct = m.probability_of_change === null
    ? `<span class="bm-nodata">no probability yet</span>`
    : `<span class="bm-prob">${(m.probability_of_change * 100).toFixed(0)}% chance of a different band</span>`;

  const caveat = "";

  const levers = m.levers.length
    ? `<ul class="levers">${m.levers.map((l) => {
        const up = l.direction === "more severe";
        // An unreachable lever has no destination, so it must not be labelled
        // with one. `to_band` is the current band in that case, and printing
        // "▼ band 2" beside an event already in band 2 reads as a move.
        const dest = l.reachable ? `${up ? "▲" : "▼"} band ${escapeHtml(l.to_band)}`
                                 : `${up ? "▲" : "▼"} no band`;
        return `<li class="${l.reachable ? "" : "lever-blocked"}">
          <span class="lv-dir lv-${up ? "up" : "down"}">${dest}</span>
          <span class="lv-name">${escapeHtml(l.name)}</span>
          <span class="lv-change">${escapeHtml(l.change)}</span>
        </li>`;
      }).join("")}</ul>`
    : '<p class="empty">Nothing single-handedly moves this one.</p>';

  // Three states, not two. "No boundary either side" is the common one and is
  // not the same as "comfortably inside": nothing this score could become moves
  // the band, which is a stronger statement than a wide range.
  const standing = m.nearest_edge === null
    ? `<span class="bm-settled">no transferability value changes this band</span>`
    : m.tight
      ? `<span class="bm-tight">borderline: ${m.nearest_edge.toFixed(2)} from a band boundary</span>`
      : `<span class="bm-settled">holds across ${m.holds_from.toFixed(2)}–${m.holds_to.toFixed(2)}, nearest boundary ${m.nearest_edge.toFixed(2)} away</span>`;

  return `
    <p class="bm-head">
      Band <strong>${escapeHtml(m.band)}</strong> — about one in ${m.years} years.
      ${standing}
      ${pct}
    </p>
    <p class="bm-basis">${escapeHtml(m.basis)}</p>
    ${caveat}
    ${levers}`;
}

// Escalation is not routing. Routing asks an owner "could this happen in your
// area" — a question. This says "someone above the line needs to look" — a
// demand, with a recipient, a reason and an acknowledgement.
const LEVEL_LABEL = { team: "Team", committee: "Committee", executive: "Executive" };

function escalationBlock(e, targets) {
  const raised = (e.escalations || []).map((x) => `
    <li class="esc ${x.open ? "is-open" : "is-ack"}">
      <span class="esc-level esc-${x.level}">${escapeHtml(LEVEL_LABEL[x.level] || x.level)}</span>
      <span class="esc-to">${escapeHtml(x.to)}</span>
      <span class="esc-reason">${escapeHtml(x.reason)}</span>
      <span class="esc-meta">${escapeHtml(x.raised_by)}${
        x.open ? " · awaiting acknowledgement"
               : ` · acknowledged by ${escapeHtml(x.acknowledged_by || "")}`}</span>
      ${x.open ? `<button class="btn esc-ack" data-to="${escapeHtml(x.to)}">Acknowledge</button>` : ""}
    </li>`).join("");

  const options = Object.entries(targets || {}).map(([level, names]) =>
    `<optgroup label="${escapeHtml(LEVEL_LABEL[level] || level)}">${
      names.map((n) => `<option value="${escapeHtml(n)}" data-level="${level}">${escapeHtml(n)}</option>`).join("")
    }</optgroup>`).join("");

  return `
    ${raised ? `<ul class="escalations">${raised}</ul>` : ""}
    <div class="esc-add">
      <select id="esc-to" aria-label="Escalate to">${options}</select>
      <input type="text" id="esc-reason" maxlength="500"
             placeholder="Why this needs escalating — required" aria-label="Reason">
      <button class="btn" id="esc-save">Escalate</button>
    </div>
    <p class="field-hint">A reason is required. An escalation without one is a
    forward, and the recipient has to work out why it reached them.</p>`;
}

function assignmentBlock(e, targets) {
  const owners = (targets?.team || []);
  const opts = ['<option value="">— unassigned —</option>']
    .concat(owners.map((o) =>
      `<option value="${escapeHtml(o)}"${o === e.assigned_to ? " selected" : ""}>${escapeHtml(o)}</option>`))
    .join("");
  return `<div class="classify">
    <select id="assign-to" aria-label="Assign to">${opts}</select>
    <button class="btn" id="assign-save">Assign</button>
  </div>`;
}

async function openDrawer(eventId) {
  // Reflect the open event in the URL so a specific finding can be sent to a
  // colleague as a link rather than described.
  const url = new URL(window.location);
  url.searchParams.set("event", eventId);
  history.replaceState(null, "", url);

  const [res, targetsRes] = await Promise.all([
    fetch(`/api/events/${eventId}`),
    fetch('/api/escalation-targets'),
  ]);
  if (!res.ok) return;
  const e = await res.json();
  const targets = targetsRes.ok ? await targetsRes.json() : {};
  const sev = severityClass(e.likelihood, e.impact);

  const dims = e.transferability_breakdown.map((d) => {
    const evidence = (d.evidence || []).length
      ? `<ul class="dim-ev">${d.evidence.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
      : "";
    const badge = d.reasoned
      ? `<span class="dim-tag">reasoned</span>`
      : "";
    return `
    <div class="dim-row ${d.dormant ? "dormant" : ""}">
      <div class="dim-head">
        <span class="dim-name">${escapeHtml(d.dimension.replace(/_/g, " "))}${badge}</span>
        <span class="dim-val">${d.score.toFixed(2)} × ${d.weight.toFixed(2)} = ${d.contribution.toFixed(3)}</span>
      </div>
      <div class="dim-bar"><i style="width:${Math.round(d.contribution * 100 / 0.3)}%"></i></div>
      <div class="dim-why">${escapeHtml(d.rationale)}</div>
      ${evidence}
    </div>`;
  }).join("");

  const consults = e.consultations.length ? e.consultations.map((c) => `
    <div class="consult" data-capability="${escapeHtml(c.capability_id)}">
      <span class="consult-owner">${escapeHtml(c.owner_role)}</span>
      <button data-r="relevant" aria-pressed="${c.response === "relevant"}">relevant</button>
      <button data-r="take_into_account" aria-pressed="${c.response === "take_into_account"}">note</button>
      <button data-r="not_relevant" aria-pressed="${c.response === "not_relevant"}">not relevant</button>
    </div>`).join("") : '<p class="empty">No owning capability identified — needs manual routing.</p>';

  const sources = e.sources.map((u) =>
    `<li><a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u)}</a></li>`).join("");

  $("drawer-body").innerHTML = `
    <h3>${escapeHtml(e.title)}</h3>
    <p><span class="pill ${e.event_type}">${e.event_type.replace("_", " ")}</span>
       <span class="cell-badge sev-${sev}">${e.likelihood}${e.impact}</span>
       <span class="verdict ${e.business_verdict}">${e.business_verdict.replace(/_/g, " ")}</span></p>

    <nav class="tabs" role="tablist">
      <button class="tab is-active" data-tab="workflow" role="tab" aria-selected="true">What to do</button>
      <button class="tab" data-tab="assess" role="tab" aria-selected="false">Assessment</button>
      <button class="tab" data-tab="evidence" role="tab" aria-selected="false">Evidence</button>
      <button class="tab" data-tab="history" role="tab" aria-selected="false">History</button>
    </nav>

    <section class="tab-panel" data-panel="workflow">
      <h4>What we did about it</h4>
      ${dispositionBlock(e)}
      <div class="note-add">
        <input type="text" id="note-text" placeholder="Add a note — appended, never edited"
               maxlength="600" aria-label="Add a note">
        <button class="btn" id="note-save">Add</button>
      </div>

      <h4>Assigned to</h4>
      ${assignmentBlock(e, targets)}

      <h4>Escalation</h4>
      ${escalationBlock(e, targets)}

      <h4>Routing — ${escapeHtml(e.routing_note)}</h4>
      ${consults}

      <h4>Category</h4>
      ${categoryBlock(e)}
    </section>

    <section class="tab-panel" data-panel="assess" hidden>
    <h4>Assessment</h4>
    <dl class="kv">
      <dt>Priority</dt><dd>${e.priority.toFixed(3)}</dd>
      <dt>Transferability</dt><dd>${(e.transferability ?? 0).toFixed(3)}</dd>
      <dt>Category</dt><dd>${escapeHtml(e.orx_l1 || "unclassified")}</dd>
      <dt>Novelty</dt><dd>${e.novelty.toFixed(2)}</dd>
      <dt>Source reliability</dt><dd>${e.source_reliability.toFixed(2)}</dd>
      ${e.scaled_loss_chf ? `<dt>Scaled loss</dt><dd>CHF ${Math.round(e.scaled_loss_chf).toLocaleString()}</dd>` : ""}
      ${e.financial_impact ? `<dt>Financial axis</dt><dd>${e.financial_impact}</dd>` : ""}
      ${e.qualitative_impact ? `<dt>Qualitative axis</dt><dd>${e.qualitative_impact}</dd>` : ""}
    </dl>

    <h4>Could this happen here?</h4>
    ${dims}

    <h4>Why this materiality</h4>
    <p class="rationale">${escapeHtml(e.materiality_rationale || "—")}</p>

    <h4>How firm is this band?</h4>
    ${bandMarginBlock(e)}

    ${attentionChip(e.attention_detail)}

    </section>

    <section class="tab-panel" data-panel="evidence" hidden>
    <h4>Where these values came from</h4>
    ${provenanceBlock(e)}

    <h4>Already covered?</h4>
    ${coverageBlock(e.coverage)}

    <h4>Sources (${e.sources.length})</h4>
    <ul class="src-list">${sources}</ul>
    </section>

    <section class="tab-panel" data-panel="history" hidden>
      <h4>History</h4>
      <div id="history-body">${historyBlock(e.history)}</div>
    </section>`;

  const activateTab = (want) => {
    const tabs = $("drawer-body").querySelectorAll(".tab");
    if (![...tabs].some((t) => t.dataset.tab === want)) return;
    tabs.forEach((t) => {
      const on = t.dataset.tab === want;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", String(on));
    });
    $("drawer-body").querySelectorAll(".tab-panel").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== want;
    });
  };
  $("drawer-body").querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  });

  // A screenshot or a slide needs to land on a specific tab, not the default.
  // ?tab=assess opens the six dimensions directly; compact mode assumes it,
  // since the workflow tab has nothing to show without its prose.
  const q = new URLSearchParams(window.location.search);
  const wantTab = q.get("tab") || (q.get("compact") === "1" ? "assess" : null);
  if (wantTab) activateTab(wantTab);

  $("esc-save").addEventListener("click", async () => {
    const sel = $("esc-to");
    const reason = $("esc-reason").value.trim();
    const btn = $("esc-save");
    if (!reason) { btn.textContent = "Reason required"; return; }
    const res = await fetch(`/api/events/${eventId}/escalate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: sel.value,
        level: sel.selectedOptions[0]?.dataset.level || "team",
        reason,
      }),
    });
    if (!res.ok) {
      btn.textContent = ((await res.json().catch(() => ({}))).detail || "rejected").slice(0, 34);
      return;
    }
    await openDrawer(eventId);
    await load();
  });

  $("drawer-body").querySelectorAll(".esc-ack").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/events/${eventId}/acknowledge`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: btn.dataset.to }),
      });
      await openDrawer(eventId);
      await load();
    });
  });

  $("assign-save").addEventListener("click", async () => {
    await fetch(`/api/events/${eventId}/disposition`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        disposition: e.disposition, assigned_to: $("assign-to").value,
      }),
    });
    $("assign-save").textContent = "Assigned";
    await refreshHistory();
    await load();
  });

  $("cat-save").addEventListener("click", async () => {
    const l1 = $("cat-correct").value;
    if (!l1) return;
    const res = await fetch(`/api/events/${eventId}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ l1 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      $("cat-save").textContent = (err.detail || "rejected").slice(0, 40);
      return;
    }
    $("cat-save").textContent = "Recorded";
    setTimeout(() => { $("cat-save").textContent = "Confirm"; }, 1500);
    await refreshHistory();
    await load();
  });

  const refreshHistory = async () => {
    const r = await fetch(`/api/events/${eventId}/history`).then((x) => x.json());
    $("history-body").innerHTML = historyBlock(r.history);
  };

  $("drawer-body").querySelectorAll(".disp-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const res = await fetch(`/api/events/${eventId}/disposition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disposition: btn.dataset.disp }),
      });
      if (!res.ok) return;
      btn.closest(".disp").querySelectorAll(".disp-btn")
         .forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      await refreshHistory();
      await load();
    });
  });

  const saveNote = async () => {
    const box = $("note-text");
    const text = box.value.trim();
    if (!text) return;
    const res = await fetch(`/api/events/${eventId}/note`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return;
    box.value = "";
    await refreshHistory();
  };
  $("note-save").addEventListener("click", saveNote);
  $("note-text").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") saveNote();
  });

  $("drawer-body").querySelectorAll(".consult button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".consult");
      await fetch(`/api/events/${eventId}/consult`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability_id: row.dataset.capability,
          response: btn.dataset.r,
          channel: "system",
        }),
      });
      row.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      await load();
    });
  });

  $("drawer").hidden = false;
  $("scrim").hidden = false;
}

function closeDrawer() {
  $("drawer").hidden = true;
  $("scrim").hidden = true;
  const url = new URL(window.location);
  url.searchParams.delete("event");
  history.replaceState(null, "", url);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function renderLegends() {
  $("radar-legend").innerHTML =
    `<span><i class="swatch" style="background:${css("--type-incident")}"></i>accumulated priority</span>
     <span>ring = 25% of the largest category</span>`;
  const ramp = ["--seq-100", "--seq-300", "--seq-500", "--seq-700"]
    .map((v) => `<i style="background:${css(v)}"></i>`).join("");
  $("heat-legend").innerHTML =
    `<span>fewer <span class="ramp">${ramp}</span> more events</span>`;
}

/* The two-engine switch. Private runs a local open-source model — nothing
   leaves the machine. Frontier runs a hosted model — stronger, particularly on
   German and on Level-2. Both are permitted by the brief, and swapping is a
   setting rather than a rebuild, which is the whole point of the design. */
function renderMode() {
  const m = state.meta.llm;
  const local = $("mode-local");
  const frontier = $("mode-frontier");
  const openai = $("mode-openai");

  local.setAttribute("aria-pressed", String(m.backend === "local"));
  frontier.setAttribute("aria-pressed", String(m.backend === "anthropic"));
  if (openai) openai.setAttribute("aria-pressed", String(m.backend === "openai"));

  local.disabled = !m.local_available;
  frontier.disabled = !m.anthropic_available;
  if (openai) openai.disabled = !m.openai_available;

  local.title = m.local_available
    ? `local · ${m.local_model} — no data leaves this machine`
    : "ollama is not running";
  frontier.title = m.anthropic_available
    ? `hosted · ${m.frontier_model} — highest accuracy`
    : "no Anthropic credentials configured";
  if (openai) {
    openai.title = m.openai_available
      ? `hosted · ${m.openai_model} — OpenAI / Kimi API`
      : "no OPENAI_API_KEY / KIMI_API_KEY configured";
  }

  const note = {
    local: `${m.local_model} · offline, nothing leaves this machine`,
    anthropic: `${m.frontier_model} · highest accuracy`,
    openai: `${m.openai_model} · OpenAI / Kimi cloud engine`,
    none: "no engine available — rules baseline only",
  }[m.backend] || `${m.backend} engine active`;
  $("mode-note").textContent = note;
}

async function setMode(backend) {
  const res = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backend }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "could not switch" }));
    $("mode-note").textContent = err.detail;
    return;
  }
  state.meta.llm = await res.json();
  renderMode();
}

function renderMeta() {
  const m = state.meta;
  $("meta").innerHTML = `
    <div><b>${m.articles}</b>articles</div>
    <div><b>${m.events}</b>events</div>
    <div><b>${m.sources.length}</b>sources</div>`;
  $("config-banner").hidden = !m.using_example_config;
}

// Categories come from the events actually present, not from the whole
// taxonomy: offering a filter that returns nothing is worse than not offering
// it. Counts are shown because "Technology (3)" tells you something the bare
// label does not.
function populateCategories() {
  const counts = new Map();
  for (const e of state.events) {
    const c = e.orx_l1;
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const sel = $("cat-filter");
  const keep = state.cat;
  sel.innerHTML = '<option value="">all categories</option>';
  for (const [name, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = `${name} (${n})`;
    sel.appendChild(o);
  }
  sel.value = keep;
}

// The window lives on the server because as-at ranking recomputes priority,
// and the client only ever receives the finished number.
function eventsQuery() {
  const q = new URLSearchParams({ limit: "400" });
  const w = windowDates();
  if (w.since) q.set("since", w.since);
  if (w.until) q.set("until", w.until);
  // Only meaningful for a closed window. "Last 30 days" already ends today.
  if (w.until && state.asAt) q.set("as_at", w.until);
  if (state.top === "cat10") q.set("per_category", "10");
  return q.toString();
}

// A month is a closed window; a rolling period ends today. That difference is
// why as-at is offered for one and hidden for the other.
function windowDates() {
  if (state.period === "month" && state.month) {
    const [y, m] = state.month.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { since: `${state.month}-01`, until: last };
  }
  const days = Number(state.period);
  if (!days) return {};
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return { since };
}

async function load() {
  const [meta, events, summary] = await Promise.all([
    fetch("/api/meta").then((r) => r.json()),
    fetch(`/api/events?${eventsQuery()}`).then((r) => r.json()),
    fetch("/api/summary").then((r) => r.json()),
  ]);
  state.meta = meta;
  state.events = events.events;
  state.summary = summary;

  // URL first, then reflect it back into the controls, so a shared link opens
  // on exactly the view it describes rather than the default one.
  const wantThreshold = readUrl();
  applyThresholdToggle(wantThreshold);
  $("threshold-toggle").checked = wantThreshold;
  $("threshold-out").textContent = `(T \u2265 ${configuredThreshold().toFixed(2)})`;
  populateCategories();
  $("type-filter").value = state.type;
  $("cat-filter").value = state.cat;
  $("review-filter").checked = state.review;
  $("disposition-filter").value = state.disposition;
  $("period-filter").value = state.period;
  $("month-filter").value = state.month;
  $("top-filter").value = state.top;
  $("page-size").value = String(state.pageSize);
  $("asat-toggle").checked = state.asAt;
  syncPeriodControls();

  renderMeta();
  renderMode();
  renderLegends();
  drawRadar(summary.radar);
  drawMatrix(summary.matrix);
  drawHeatmap(summary);
  // Calibration is not part of the working view. It is fetched only when asked
  // for, so it costs a page load nothing and always reflects the store as it
  // stands right now rather than as it stood when the tab was opened.
  if (state.calibration) showCalibration();
  renderTable();

  const deepLink = new URLSearchParams(window.location.search).get("event");
  if (deepLink) openDrawer(deepLink);
}

$("mode-local").addEventListener("click", () => setMode("local"));
$("mode-frontier").addEventListener("click", () => setMode("anthropic"));
if ($("mode-openai")) $("mode-openai").addEventListener("click", () => setMode("openai"));

// The threshold is a toggle, not a slider. A continuous 0.00-0.90 control asks
// the reader to have an intuition about a number nobody has one for, and it
// defaults to 0, so it sat there doing nothing. The config already defines the
// meaningful cut — `transferability_threshold` — and the pipeline reports
// against it, so the toggle just applies that.
//
// It is not redundant with the ranking. Transferability is 0.25 of the priority
// score, which sinks a low-transferability event but never removes it: a 2A
// incident scoring 0.28 still ranks second on materiality alone. Weighting
// reorders; the filter answers a different question.
function configuredThreshold() {
  return state.meta?.transferability_threshold ?? 0.55;
}

function applyThresholdToggle(on) {
  state.threshold = on ? configuredThreshold() : 0;
  $("dl-csv").href = new URL("downloads/radar.csv", window.location.href).href;
  $("dl-json").href = new URL("downloads/radar.json", window.location.href).href;
}

$("threshold-toggle").addEventListener("change", (e) => {
  applyThresholdToggle(e.target.checked);
  state.page = 1;
  syncUrl();
  renderTable();
});
$("type-filter").addEventListener("change", (e) => {
  state.type = e.target.value; state.page = 1; syncUrl(); renderTable();
});
$("cat-filter").addEventListener("change", (e) => {
  // Choosing a category drops any capability pinned from the heatmap. The two
  // together name one cell, and keeping the capability while changing the
  // category silently asks for a pair the reader never pointed at — usually an
  // empty one, which reads as a broken filter.
  // No scroll: the dropdown is in the sticky toolbar and moving the page
  // under a control the reader is still looking at is disorienting. A chart
  // click is different — the thing clicked is about to leave the viewport.
  selectCategory(e.target.value, false);
});
$("review-filter").addEventListener("change", (e) => {
  state.review = e.target.checked; state.page = 1; syncUrl(); renderTable();
});
$("disposition-filter").addEventListener("change", (e) => {
  state.disposition = e.target.value; state.page = 1; syncUrl(); renderTable();
});

// Only a month gets the as-at choice, and the month box only appears when a
// month is what you asked for.
function syncPeriodControls() {
  const isMonth = state.period === "month";
  $("month-wrap").hidden = !isMonth;
  $("asat-wrap").hidden = !(isMonth && state.month);
}

// These three change the SERVER query, so they reload rather than re-render.
$("period-filter").addEventListener("change", async (e) => {
  state.period = e.target.value;
  if (state.period !== "month") state.month = "";
  state.page = 1;
  syncPeriodControls(); syncUrl(); await load();
});
$("month-filter").addEventListener("change", async (e) => {
  state.month = e.target.value; state.page = 1; syncPeriodControls(); syncUrl(); await load();
});
$("asat-toggle").addEventListener("change", async (e) => {
  state.asAt = e.target.checked; state.page = 1; syncUrl(); await load();
});
$("top-filter").addEventListener("change", async (e) => {
  state.top = e.target.value;
  state.page = 1;
  syncUrl();
  // per-category is a server cap; a plain top-N is a display cap.
  if (state.top === "cat10") await load(); else renderTable();
});

$("page-size").addEventListener("change", (e) => {
  state.pageSize = Number(e.target.value);
  state.page = 1;
  syncUrl();
  renderTable();
});
$("page-prev").addEventListener("click", () => {
  if (state.page <= 1) return;
  state.page -= 1;
  syncUrl();
  renderTable();
});
$("page-next").addEventListener("click", () => {
  const pages = Math.max(1, Math.ceil(visibleEvents().length / state.pageSize));
  if (state.page >= pages) return;
  state.page += 1;
  syncUrl();
  renderTable();
});

// Clicking a header sorts by it; clicking the active one reverses. Every sort
// starts descending, because on every one of these columns "most" is the
// interesting end.
document.querySelectorAll("#event-table th.sortable").forEach((th) => {
  th.tabIndex = 0;
  const activate = () => {
    const key = th.dataset.sort;
    if (state.sort === key) {
      state.dir = state.dir === "desc" ? "asc" : "desc";
    } else {
      state.sort = key;
      state.dir = "desc";
    }
    state.page = 1;
    syncUrl();
    renderTable();
  };
  th.addEventListener("click", activate);
  th.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
  });
});

function renderSortIndicators() {
  document.querySelectorAll("#event-table th.sortable").forEach((th) => {
    const on = th.dataset.sort === state.sort;
    th.classList.toggle("is-sorted", on);
    th.classList.toggle("asc", on && state.dir === "asc");
    th.setAttribute("aria-sort", on ? (state.dir === "asc" ? "ascending" : "descending") : "none");
  });
}

// Sort and filter live in the URL, like ?event= already does — so a filtered,
// sorted view is a link you can put in a slide or send to someone.
function syncUrl() {
  const url = new URL(window.location);
  const set = (k, v, dflt) => v && v !== dflt ? url.searchParams.set(k, v) : url.searchParams.delete(k);
  set("sort", state.sort, "priority");
  set("dir", state.dir, "desc");
  set("cat", state.cat, "");
  set("cell", state.cell, "");
  set("cap", state.cap, "");
  set("type", state.type, "");
  set("min", state.threshold ? "1" : "", "");
  set("review", state.review ? "1" : "", "");
  set("disp", state.disposition, "");
  set("period", state.period, "");
  set("month", state.month, "");
  set("top", state.top, "");
  set("page", state.page > 1 ? String(state.page) : "", "");
  set("rows", state.pageSize !== 10 ? String(state.pageSize) : "", "");
  set("asat", state.asAt ? "" : "0", "");
  set("calib", state.calibration ? "1" : "", "");
  history.replaceState(null, "", url);
}

function readUrl() {
  const q = new URLSearchParams(window.location.search);
  if (SORT_KEY[q.get("sort")]) state.sort = q.get("sort");
  if (q.get("dir") === "asc") state.dir = "asc";
  state.cat = q.get("cat") || "";
  state.cell = (q.get("cell") || "").toUpperCase();
  state.cap = q.get("cap") || "";
  state.type = q.get("type") || "";
  state.review = q.get("review") === "1";
  state.disposition = q.get("disp") || "";
  state.period = q.get("period") || "";
  state.month = q.get("month") || "";
  state.top = q.get("top") || "";
  const page = Number(q.get("page"));
  const pageSize = Number(q.get("rows"));
  state.page = Number.isInteger(page) && page > 0 ? page : 1;
  state.pageSize = [10, 25, 50].includes(pageSize) ? pageSize : 10;
  state.asAt = q.get("asat") !== "0";
  state.calibration = q.get("calib") === "1";
  return q.get("min") === "1";
}
// Connected, connected-on-the-example, and absent are three states, not two. A
// demo wired entirely to config.example/ is not a deployment, and showing both
// as "connected" would say it was.
async function showInputs() {
  const card = $("inputs-card");
  const data = await fetch("/api/inputs").then((r) => r.json());
  const rows = data.inputs.map((i) => {
    const state = !i.connected ? "absent" : i.example ? "example" : "own";
    const label = { absent: "not configured", example: "stand-in", own: "configured" }[state];
    return `<li class="input-row is-${state}">
      <span class="input-state">${label}</span>
      <span class="input-label">${escapeHtml(i.label)}</span>
      <span class="input-detail">${escapeHtml(i.detail)}</span>
      ${!i.connected ? `<span class="input-unlocks">${escapeHtml(i.unlocks)}</span>` : ""}
    </li>`;
  }).join("");
  $("inputs-body").innerHTML = `
    <p class="inputs-count"><b>${data.connected} of ${data.total}</b> inputs connected${
      data.on_example_config
        ? " — all from the public example, none from a real institution" : ""
    }.</p>
    <ul class="inputs">${rows}</ul>`;
  card.hidden = false;
  $("inputs-toggle").setAttribute("aria-expanded", "true");
  card.scrollIntoView({ behavior: "smooth", block: "center" });
}

$("inputs-toggle").addEventListener("click", async () => {
  const card = $("inputs-card");
  if (card.hidden) { await showInputs(); }
  else { card.hidden = true; $("inputs-toggle").setAttribute("aria-expanded", "false"); }
});

// Calibration lives behind a quiet button rather than on the dashboard. It
// answers a question about the MODEL, not about this week's risk, so it belongs
// in a review or a presentation and not in the working view. Fetched on open so
// a long-lived tab never shows a stale curve.
async function showCalibration() {
  const card = $("calibration-card");
  const cal = await fetch("/api/calibration").then((r) => r.json());
  drawCalibration(cal);
  card.hidden = false;
  $("calib-toggle").setAttribute("aria-expanded", "true");
  card.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideCalibration() {
  $("calibration-card").hidden = true;
  $("calib-toggle").setAttribute("aria-expanded", "false");
}

$("calib-toggle").addEventListener("click", async () => {
  state.calibration = $("calibration-card").hidden;
  if (state.calibration) await showCalibration(); else hideCalibration();
  syncUrl();
});

$("drawer-close").addEventListener("click", closeDrawer);
$("scrim").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

load();
