/* Browser-local API adapter for the public prototype.
 *
 * The production UI talks to FastAPI. This file supplies the same response
 * shapes from a checked-in snapshot so the prototype stays awake on GitHub
 * Pages. Viewer edits are kept in localStorage and never leave the browser.
 */
(function () {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  const scriptUrl = document.currentScript.src;
  const dataUrl = new URL("demo-data.json", scriptUrl);
  const storageKey = "riskon-public-demo-v1";
  const statePromise = nativeFetch(dataUrl).then((response) => {
    if (!response.ok) throw new Error(`Could not load demo data (${response.status})`);
    return response.json();
  }).then((seed) => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch (_) {}
    if (saved?.profile) seed.profile = saved.profile;
    if (saved?.source_catalog) seed.source_catalog = saved.source_catalog;
    if (saved?.details) {
      for (const [id, changes] of Object.entries(saved.details)) {
        if (seed.details[id]) Object.assign(seed.details[id], changes);
      }
    }
    syncCards(seed);
    return seed;
  });

  function response(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function persist(data) {
    const details = {};
    for (const [id, detail] of Object.entries(data.details)) {
      if ((detail.history || []).length || (detail.escalations || []).length ||
          detail.disposition !== "new" || detail.assigned_to || detail.orx_corrected) {
        details[id] = {
          history: detail.history,
          escalations: detail.escalations,
          escalations_open: detail.escalations_open,
          escalated: detail.escalated,
          escalation_level: detail.escalation_level,
          disposition: detail.disposition,
          assigned_to: detail.assigned_to,
          is_open: detail.is_open,
          orx_l1: detail.orx_l1,
          orx_corrected: detail.orx_corrected,
          consultations: detail.consultations,
        };
      }
    }
    localStorage.setItem(storageKey, JSON.stringify({
      profile: data.profile,
      source_catalog: data.source_catalog,
      details,
    }));
  }

  function syncCards(data) {
    const mutable = ["disposition", "assigned_to", "is_open", "orx_l1",
      "orx_corrected", "escalated", "escalation_level", "escalations_open"];
    for (const card of data.events.events) {
      const detail = data.details[card.event_id];
      if (!detail) continue;
      for (const key of mutable) card[key] = detail[key];
    }
  }

  function now() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "");
  }

  function addHistory(detail, kind, verdict, note = null) {
    detail.history = detail.history || [];
    detail.history.unshift({
      kind, verdict, note, decided_by: "prototype viewer", decided_at: now(),
      model_said: null, model_name: "static demo",
    });
  }

  function filteredEvents(data, url) {
    const query = url.searchParams;
    const since = query.get("since");
    const until = query.get("until");
    const minimum = Number(query.get("min_transferability") || 0);
    const limit = Number(query.get("limit") || 200);
    const perCategory = Number(query.get("per_category") || 0);
    const seen = {};
    const events = data.events.events.filter((event) => {
      if ((event.transferability || 0) < minimum) return false;
      if (since && (!event.reported_on || event.reported_on < since)) return false;
      if (until && (!event.reported_on || event.reported_on > until)) return false;
      if (perCategory) {
        const category = event.orx_l1 || "unclassified";
        if ((seen[category] || 0) >= perCategory) return false;
        seen[category] = (seen[category] || 0) + 1;
      }
      return true;
    }).slice(0, limit);
    return {
      count: events.length,
      total: data.events.total,
      window: { since, until, as_at: query.get("as_at") },
      events,
    };
  }

  function sourceCatalogWithStats(data, incoming) {
    const prior = new Map(data.source_catalog.catalog.sources.map((s) => [s.id, s]));
    const catalog = clone(incoming);
    catalog.sources = catalog.sources.map((source) => ({
      ...source,
      stats: prior.get(source.id)?.stats || { article_count: 0 },
      health: prior.get(source.id)?.health || null,
    }));
    return catalog;
  }

  async function demoFetch(input, init = {}) {
    const raw = typeof input === "string" ? input : input.url;
    const url = new URL(raw, window.location.href);
    if (!url.pathname.startsWith("/api/")) return nativeFetch(input, init);

    const data = await statePromise;
    const method = (init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : {};
    const path = url.pathname;

    if (method === "GET" && path === "/api/meta") return response(clone(data.meta));
    if (method === "GET" && path === "/api/events") return response(clone(filteredEvents(data, url)));
    if (method === "GET" && path === "/api/summary") return response(clone(data.summary));
    if (method === "GET" && path === "/api/inputs") return response(clone(data.inputs));
    if (method === "GET" && path === "/api/calibration") return response(clone(data.calibration));
    if (method === "GET" && path === "/api/escalation-targets") return response(clone(data.escalation_targets));
    if (method === "GET" && path === "/api/profile") return response(clone(data.profile));
    if (method === "GET" && path === "/api/profile/seed") return response(clone(data.profile_seed));
    if (method === "GET" && path === "/api/source-catalog") return response(clone(data.source_catalog));
    if (method === "GET" && path === "/api/source-catalog/seed") return response(clone(data.source_catalog_seed));

    const eventMatch = path.match(/^\/api\/events\/([^/]+)(?:\/(.*))?$/);
    if (eventMatch) {
      const eventId = decodeURIComponent(eventMatch[1]);
      const action = eventMatch[2] || "";
      const detail = data.details[eventId];
      if (!detail) return response({ detail: "event not found" }, 404);
      if (method === "GET" && !action) return response(clone(detail));
      if (method === "GET" && action === "history") return response({ history: clone(detail.history || []) });

      if (method === "POST" && action === "disposition") {
        if (body.disposition !== undefined) {
          detail.disposition = body.disposition;
          detail.is_open = ["new", "in_review"].includes(body.disposition);
          addHistory(detail, "disposition", body.disposition);
        }
        if (body.assigned_to !== undefined) {
          detail.assigned_to = body.assigned_to || null;
          addHistory(detail, "assignment", body.assigned_to || "unassigned");
        }
      } else if (method === "POST" && action === "classify") {
        addHistory(detail, "classification", body.l1, null);
        detail.orx_model_said = detail.orx_model_said || detail.orx_l1;
        detail.orx_l1 = body.l1;
        detail.orx_corrected = true;
      } else if (method === "POST" && action === "note") {
        addHistory(detail, "note", "added", body.text);
      } else if (method === "POST" && action === "consult") {
        const item = (detail.consultations || []).find((c) => c.capability_id === body.capability_id);
        if (item) item.response = body.response;
        addHistory(detail, "consultation", `${body.capability_id}=${body.response}`);
      } else if (method === "POST" && action === "escalate") {
        detail.escalations = detail.escalations || [];
        detail.escalations.push({
          to: body.to, level: body.level, reason: body.reason,
          raised_by: "prototype viewer", raised_at: now(), acknowledged_by: null, open: true,
        });
        detail.escalated = true;
        detail.escalation_level = body.level;
        detail.escalations_open = detail.escalations.filter((e) => e.open).length;
        addHistory(detail, "escalation", `${body.level}:${body.to}`, body.reason);
      } else if (method === "POST" && action === "acknowledge") {
        const item = (detail.escalations || []).find((e) => e.to === body.to && e.open);
        if (item) { item.open = false; item.acknowledged_by = "prototype viewer"; }
        detail.escalations_open = detail.escalations.filter((e) => e.open).length;
      } else {
        return response({ detail: "unsupported demo action" }, 404);
      }
      syncCards(data);
      persist(data);
      return response({ ok: true });
    }

    if (method === "PUT" && path === "/api/profile") {
      const next = Number(data.profile.version || 0) + 1;
      data.profile = {
        profile: clone(body.profile), version: next, source: "browser-local demo revision",
        revisions: [{ version: next, saved_at: now(), note: body.note || "demo edit" },
          ...(data.profile.revisions || [])],
      };
      persist(data);
      return response({ ok: true, version: next });
    }

    if (method === "PUT" && path === "/api/source-catalog") {
      const next = Number(data.source_catalog.version || 0) + 1;
      const catalog = sourceCatalogWithStats(data, body.catalog);
      catalog.version = next;
      data.source_catalog = {
        ...data.source_catalog, catalog, version: next, source: "browser-local demo revision",
        revisions: [{ version: next, saved_at: now(), note: body.note || "demo edit" },
          ...(data.source_catalog.revisions || [])],
      };
      persist(data);
      return response({ ok: true, version: next });
    }

    const sourceMatch = path.match(/^\/api\/sources\/([^/]+)\/(check|ingest)$/);
    if (method === "POST" && sourceMatch) {
      const sourceId = decodeURIComponent(sourceMatch[1]);
      const action = sourceMatch[2];
      const source = data.source_catalog.catalog.sources.find((s) => s.id === sourceId);
      if (!source) return response({ detail: "source not found" }, 404);
      if (action === "check") {
        source.health = {
          status: "healthy", http_status: 200, entry_count: 24, latency_ms: 84,
          checked_at: now(), message: "demo health check passed",
        };
        persist(data);
        return response(clone(source.health));
      }
      return response({ entries_seen: 24, articles_new: 0, demo: true });
    }

    if (method === "POST" && path === "/api/llm") {
      return response({ detail: "Engine switching is disabled in the static public demo." }, 409);
    }

    return response({ detail: "not available in the static public demo" }, 404);
  }

  window.fetch = demoFetch;
})();
