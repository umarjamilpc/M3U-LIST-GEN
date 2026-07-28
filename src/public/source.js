(function () {
  const root = document.getElementById("source-mode-root");
  if (!root) return;

  const boxes = [...root.querySelectorAll('input[name="source_mode"]')];
  const panels = {
    iptvorg: document.getElementById("source-panel-iptvorg"),
    urls: document.getElementById("source-panel-urls"),
    uploads: document.getElementById("source-panel-uploads"),
  };

  function sync() {
    const on = new Set(boxes.filter((b) => b.checked).map((b) => b.value));
    Object.keys(panels).forEach((key) => {
      const panel = panels[key];
      if (!panel) return;
      const active = on.has(key);
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    // Ensure at least one country stays selected when iptv-org is on
    const countrySel = document.getElementById("pl-countries");
    if (countrySel && on.has("iptvorg")) {
      const any = [...countrySel.options].some((o) => o.selected);
      if (!any) {
        const us = [...countrySel.options].find((o) => o.value === "US");
        if (us) us.selected = true;
        else if (countrySel.options.length) countrySel.options[0].selected = true;
      }
    }
    const hint = document.getElementById("source-mode-hint");
    if (hint) {
      if (on.size === 0) hint.textContent = "Select at least one source.";
      else if (on.size === 1) hint.textContent = "Using a single source.";
      else
        hint.textContent =
          "Merging " +
          on.size +
          " sources (duplicates removed by stream URL).";
    }
  }

  boxes.forEach((b) => b.addEventListener("change", sync));
  sync();

  const form = document.getElementById("playlist-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      const on = boxes.filter((b) => b.checked).map((b) => b.value);
      if (!on.length) {
        e.preventDefault();
        alert(
          "Choose at least one channel source (iptv-org, M3U URL(s), or Upload)."
        );
        return;
      }
      if (on.includes("iptvorg")) {
        const sel = document.getElementById("pl-countries");
        if (sel && ![...sel.options].some((o) => o.selected)) {
          e.preventDefault();
          alert("Select at least one iptv-org country.");
          return;
        }
      }
      if (on.includes("urls")) {
        const ta = form.querySelector('textarea[name="source_m3u_url"]');
        if (ta && !(ta.value || "").trim()) {
          e.preventDefault();
          alert("Paste at least one M3U URL, or uncheck M3U URL(s).");
          return;
        }
      }
    });
  }
})();
