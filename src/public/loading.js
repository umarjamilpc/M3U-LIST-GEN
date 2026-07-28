(function () {
  // Overlay only for slow jobs — never flash on quick Firefox navigations
  let el = null;
  let depth = 0;
  let tickTimer = null;
  let showTimer = null;
  let softPct = 0;
  const SHOW_DELAY_MS = 450;
  const isFirefox = typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent);

  function ensure() {
    if (el) return el;
    el = document.createElement("div");
    el.id = "app-loading";
    el.className = "app-loading";
    el.hidden = true;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.innerHTML =
      '<div class="app-loading-card">' +
      '<p class="app-loading-msg">Working…</p>' +
      '<div class="progress app-loading-progress" aria-label="Progress">' +
      '<div class="progress-bar" id="app-loading-bar" style="width:0%"></div>' +
      "</div>" +
      '<p class="progress-pct app-loading-pct"><span id="app-loading-pct">0</span>%</p>' +
      "</div>";
    document.body.appendChild(el);
    return el;
  }

  function setPct(n) {
    softPct = Math.max(0, Math.min(99, Math.round(n)));
    const bar = document.getElementById("app-loading-bar");
    const pct = document.getElementById("app-loading-pct");
    if (bar) bar.style.width = softPct + "%";
    if (pct) pct.textContent = String(softPct);
  }

  function startTick() {
    stopTick();
    softPct = 0;
    setPct(0);
    tickTimer = setInterval(() => {
      if (softPct >= 90) return;
      const step = softPct < 40 ? 4 : softPct < 70 ? 2 : 1;
      setPct(softPct + step);
    }, 280);
  }

  function stopTick() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function clearShowTimer() {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
  }

  function paint(msg) {
    const node = ensure();
    const p = node.querySelector(".app-loading-msg");
    if (p) p.textContent = msg || "Working…";
    startTick();
    node.hidden = false;
    document.documentElement.classList.add("is-app-loading");
  }

  function show(msg) {
    depth += 1;
    if (depth !== 1) return;
    clearShowTimer();
    const delay = isFirefox ? Math.max(SHOW_DELAY_MS, 600) : SHOW_DELAY_MS;
    showTimer = setTimeout(() => {
      showTimer = null;
      if (depth > 0) paint(msg);
    }, delay);
  }

  function hide() {
    depth = Math.max(0, depth - 1);
    if (depth > 0) return;
    clearShowTimer();
    stopTick();
    if (el) el.hidden = true;
    document.documentElement.classList.remove("is-app-loading");
  }

  function hideAll() {
    depth = 0;
    clearShowTimer();
    stopTick();
    if (el) el.hidden = true;
    document.documentElement.classList.remove("is-app-loading");
  }

  window.IptvLoading = { show, hide, hideAll, setPct };

  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.noLoading === "1") return;
    show(form.dataset.loadingMsg || "Working…");
  });

  // Intentionally no click handler for plain links — avoids Firefox nav flash
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-loading]");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    show(a.getAttribute("data-loading") || "Loading…");
  });

  window.addEventListener("pageshow", () => hideAll());
  window.addEventListener("pagehide", () => hideAll());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") hideAll();
  });
})();
