(function codexQuotaEarlyNativeSuppressor() {
  "use strict";

  const GLOBAL_KEY = "__CODEX_QUOTA_EARLY_NATIVE_SUPPRESSOR__";
  const PANEL_GLOBAL_KEY = "__CODEX_QUOTA_PANEL__";
  const STYLE_ID = "codex-quota-early-native-suppressor";
  const SELF_CLEANUP_MS = 30_000;
  const runtime = typeof window === "object" ? window : globalThis;
  const documentRef = runtime.document;
  const requestedDeadlineMs = typeof __codexQuotaEarlyDeadlineMs === "number"
    && Number.isFinite(__codexQuotaEarlyDeadlineMs)
    ? __codexQuotaEarlyDeadlineMs
    : Date.now() + SELF_CLEANUP_MS;

  function panelBlockReason() {
    const panel = runtime[PANEL_GLOBAL_KEY];
    if (!panel) return null;
    if (typeof panel.status !== "function") return "panel-state-unavailable";
    let status;
    try {
      status = panel.status();
    } catch {
      return "panel-state-unavailable";
    }
    if (!status || typeof status !== "object") return "panel-state-unavailable";
    if (status.mounted === true) return "panel-already-mounted";
    if (status.cleaned === true) return "panel-cleaned";
    if (status.freshness === "unavailable") return "panel-unavailable";
    const transientReasons = new Set([
      "not-mounted",
      "main-shell-not-ready",
      "sidebar-not-connected",
      "anchor-not-found",
      "anchor-ambiguous",
      "anchor-detached",
    ]);
    return transientReasons.has(status.reason) ? null : "panel-mount-failed";
  }

  const existing = runtime[GLOBAL_KEY];
  if (existing && typeof existing.refresh === "function") return existing.refresh(requestedDeadlineMs);
  if (!documentRef || !runtime.location || runtime.location.protocol !== "app:") {
    return { active: false, reason: "document-not-eligible" };
  }
  const initialPanelBlock = panelBlockReason();
  if (initialPanelBlock) return { active: false, reason: initialPanelBlock };
  if (Date.now() >= requestedDeadlineMs) return { active: false, reason: "deadline-expired" };

  let styleInstalled = false;
  let timer = null;
  let domReadyHandler = null;
  let rootObserver = null;
  let api = null;
  let expiresAtMs = requestedDeadlineMs;

  const STYLE_TEXT = `
    aside.app-shell-left-panel div.w-full:not(nav *):not([role="navigation"] *):not([role="list"] *):not([role="listitem"] *):not([data-app-action-sidebar-scroll] *):has(
      > div[role="status"][aria-live="polite"].flex.w-full.flex-col.rounded-2xl.border
        > progress[max="100"][value]
    ):has(
      > div[role="status"][aria-live="polite"].flex.w-full.flex-col.rounded-2xl.border
        button[type="button"].no-drag
    ),
    aside.app-shell-left-panel
      div[role="status"][aria-live="polite"].flex.w-full.flex-col.rounded-2xl.border:not(nav *):not([role="navigation"] *):not([role="list"] *):not([role="listitem"] *):not([data-app-action-sidebar-scroll] *):has(
        > progress[max="100"][value]
      ):has(button[type="button"].no-drag) {
      display: none !important;
    }
  `;

  function removeStyle() {
    const style = typeof documentRef.getElementById === "function"
      ? documentRef.getElementById(STYLE_ID)
      : null;
    if (style && style.parentNode) style.parentNode.removeChild(style);
    styleInstalled = false;
  }

  function installStyle() {
    const root = documentRef.head || documentRef.documentElement;
    if (!root || typeof documentRef.createElement !== "function") return false;
    removeStyle();
    const style = documentRef.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE_TEXT;
    root.appendChild(style);
    styleInstalled = true;
    return true;
  }

  function cleanup(reason = "self-cleanup") {
    if (timer !== null && typeof runtime.clearTimeout === "function") runtime.clearTimeout(timer);
    timer = null;
    if (domReadyHandler && typeof documentRef.removeEventListener === "function") {
      documentRef.removeEventListener("DOMContentLoaded", domReadyHandler);
    }
    domReadyHandler = null;
    if (rootObserver) rootObserver.disconnect();
    rootObserver = null;
    removeStyle();
    if (runtime[GLOBAL_KEY] === api) delete runtime[GLOBAL_KEY];
    return { active: false, reason };
  }

  function armCleanup(deadlineMs = expiresAtMs) {
    if (Number.isFinite(deadlineMs)) expiresAtMs = Math.max(expiresAtMs, deadlineMs);
    if (timer !== null && typeof runtime.clearTimeout === "function") runtime.clearTimeout(timer);
    const remaining = Math.max(0, expiresAtMs - Date.now());
    if (remaining <= 0) return cleanup("deadline-expired");
    timer = typeof runtime.setTimeout === "function"
      ? runtime.setTimeout(() => cleanup("timeout"), remaining)
      : null;
    return null;
  }

  function refresh(deadlineMs = requestedDeadlineMs) {
    const blockReason = panelBlockReason();
    if (blockReason) return cleanup(blockReason);
    if (Number.isFinite(deadlineMs) && Date.now() >= deadlineMs) return cleanup("deadline-expired");
    if (!styleInstalled) installStyle();
    const expired = armCleanup(deadlineMs);
    if (expired) return expired;
    return api.status();
  }

  api = Object.freeze({
    cleanup,
    refresh,
    status: () => ({
      active: styleInstalled,
      pending: Boolean(domReadyHandler || rootObserver),
      reason: styleInstalled ? null : domReadyHandler || rootObserver ? "style-root-pending" : "inactive",
    }),
  });
  runtime[GLOBAL_KEY] = api;
  if (!installStyle() && typeof documentRef.addEventListener === "function") {
    domReadyHandler = () => {
      domReadyHandler = null;
      if (installStyle() && rootObserver) {
        rootObserver.disconnect();
        rootObserver = null;
      }
    };
    documentRef.addEventListener("DOMContentLoaded", domReadyHandler, { once: true });
    if (typeof runtime.MutationObserver === "function") {
      rootObserver = new runtime.MutationObserver(() => {
        if (!installStyle()) return;
        rootObserver.disconnect();
        rootObserver = null;
        if (domReadyHandler && typeof documentRef.removeEventListener === "function") {
          documentRef.removeEventListener("DOMContentLoaded", domReadyHandler);
        }
        domReadyHandler = null;
      });
      rootObserver.observe(documentRef, { childList: true, subtree: true });
    }
  }
  const expired = armCleanup(requestedDeadlineMs);
  return expired || api.status();
}());
