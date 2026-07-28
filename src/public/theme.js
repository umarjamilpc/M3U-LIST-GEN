(function () {
  const KEY = "m3u-list-gen-theme";
  const root = document.documentElement;

  function syncButton(theme) {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    const t = theme === "dark" ? "dark" : "light";
    const next = t === "dark" ? "light" : "dark";
    btn.setAttribute("aria-label", next === "dark" ? "Switch to dark mode" : "Switch to light mode");
    btn.title = btn.getAttribute("aria-label");
    btn.setAttribute("data-theme-current", t);
  }

  function apply(theme, persist) {
    const t = theme === "dark" ? "dark" : "light";
    if (root.getAttribute("data-theme") !== t) {
      root.setAttribute("data-theme", t);
    }
    root.style.colorScheme = t;
    if (persist !== false) {
      try {
        localStorage.setItem(KEY, t);
      } catch (_) {}
    }
    syncButton(t);
  }

  function current() {
    const attr = root.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
    try {
      const saved =
        localStorage.getItem(KEY) || localStorage.getItem("iptv-filter-theme");
      if (saved === "dark" || saved === "light") return saved;
    } catch (_) {}
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  }

  syncButton(current());

  document.addEventListener("DOMContentLoaded", () => {
    syncButton(current());
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.addEventListener("click", () => {
        apply(current() === "dark" ? "light" : "dark", true);
      });
    }
  });
})();
