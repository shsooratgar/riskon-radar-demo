# RiskON — clickable prototype

Public, static demonstration of the Operational Risk Radar built for RiskON
2026 Challenge 2.

The dashboard, event detail workflow, risk-profile editor, source portfolio,
credibility controls, filters, pagination, and exports run entirely in the
browser. The published events contain a frozen snapshot of reasoned scores
produced by the local model; no model or API is required by the viewer. Edits
are stored in the viewer's browser and do not affect other visitors. Live web
ingestion and model execution are intentionally simulated in this public build.

The production source repository, institutional reference inputs, and database
are not included.

## Snapshot history

- 2026-09-08: Replaced the rules-only fallback with the completed local-model
  scoring snapshot; mapped classifications to the public Basel stand-in;
  regenerated chart aggregates and exports; filled missing display dates from
  the locally cached retrieval date; removed the non-functional engine switch.
- 2026-09-08: Published the initial sanitized static prototype.

Every published change is a Git commit, so the demo can be restored to any
earlier snapshot without touching the private application or database.
