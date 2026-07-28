(function () {
  // Restore scroll before the rest of the UI runs — avoids top→down jump
  try {
    if (
      sessionStorage.getItem("m3u-keep-scroll") === "1" ||
      sessionStorage.getItem("iptv-keep-scroll") === "1"
    ) {
      const y = Number(
        sessionStorage.getItem("m3u-scroll-y") ||
          sessionStorage.getItem("iptv-scroll-y") ||
          0
      );
      sessionStorage.removeItem("m3u-keep-scroll");
      sessionStorage.removeItem("iptv-keep-scroll");
      if (y > 0) {
        const jump = () => window.scrollTo(0, y);
        jump();
        requestAnimationFrame(jump);
        window.addEventListener("pageshow", jump, { once: true });
      }
    }
  } catch {
    /* ignore */
  }

  const manager = document.getElementById("cat-manager");
  const orderInput = document.getElementById("cat-order");
  const layoutInput = document.getElementById("layout-json");
  const form = document.getElementById("channels-main-form");
  let loading = false;
  let dragCat = null;
  let dragRow = null;

  function showLoading(msg) {
    if (window.IptvLoading) window.IptvLoading.show(msg);
  }
  function hideLoading() {
    if (window.IptvLoading) window.IptvLoading.hide();
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function playlistId() {
    return (
      manager?.dataset.playlistId ||
      document.getElementById("add-from-source")?.dataset.playlistId ||
      document.querySelector(".create-boxes")?.dataset.playlistId ||
      document.getElementById("create-channel-box")?.dataset.playlistId ||
      ""
    );
  }

  function appConfirm(message, { title = "Confirm", okLabel = "OK" } = {}) {
    const dialog = document.getElementById("app-confirm-dialog");
    const msg = document.getElementById("app-confirm-msg");
    const titleEl = document.getElementById("app-confirm-title");
    const okBtn = document.getElementById("app-confirm-ok");
    if (!dialog) return Promise.resolve(window.confirm(message));
    if (msg) msg.textContent = message;
    if (titleEl) titleEl.textContent = title;
    if (okBtn) okBtn.textContent = okLabel;
    dialog.returnValue = "";
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener(
        "close",
        () => {
          if (window.IptvLoading) window.IptvLoading.hideAll();
          resolve(dialog.returnValue === "ok");
        },
        { once: true }
      );
    });
  }

  function appAlert(message) {
    const dialog = document.getElementById("app-alert-dialog");
    const msg = document.getElementById("app-alert-msg");
    if (!dialog) {
      window.alert(message);
      return Promise.resolve();
    }
    if (msg) msg.textContent = message;
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener(
        "close",
        () => {
          if (window.IptvLoading) window.IptvLoading.hideAll();
          resolve();
        },
        { once: true }
      );
    });
  }

  async function refreshCategory(item) {
    if (!item) return;
    const panel = item.querySelector(".cat-panel");
    if (panel) panel.remove();
    item.classList.remove("is-open");
    await openCategory(item, { forceOpen: true });
  }

  function apiHeaders() {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Requested-With": "fetch",
    };
  }

  async function apiPost(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(body || {}),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const err = (data && data.error) || res.statusText || "Request failed";
      throw new Error(err);
    }
    return data;
  }

  function syncCatOrder() {
    if (!manager || !orderInput) return;
    const names = [...manager.querySelectorAll(".cat-item")].map((li) => li.dataset.cat || "");
    orderInput.value = names.filter(Boolean).join("||");
    scheduleLayoutSave();
  }

  let layoutSaveTimer = null;
  let layoutSaveInFlight = false;
  let layoutSavePending = false;

  function flashDbSaved(msg) {
    let el = document.getElementById("db-save-flash");
    if (!el) {
      el = document.createElement("p");
      el.id = "db-save-flash";
      el.className = "ok-msg db-save-flash";
      const head = document.querySelector("#channels-main-form .panel-head") ||
        document.querySelector(".page-head") ||
        manager;
      if (head) head.insertAdjacentElement("afterend", el);
      else document.body.prepend(el);
    }
    el.textContent = msg || "Saved to database";
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.remove(), 1800);
  }

  async function persistLayoutNow() {
    if (!manager || !playlistId()) return;
    syncCatOrder();
    buildLayoutJson();
    const raw = layoutInput?.value || "";
    let layout = null;
    try {
      layout = JSON.parse(raw);
    } catch {
      return;
    }
    if (!layout || !Array.isArray(layout.cats)) return;
    if (layoutSaveInFlight) {
      layoutSavePending = true;
      return;
    }
    layoutSaveInFlight = true;
    try {
      await apiPost(`/playlists/${playlistId()}/channels/api/save-layout`, { layout });
      flashDbSaved("Channel layout saved");
    } catch (err) {
      console.error(err);
    } finally {
      layoutSaveInFlight = false;
      if (layoutSavePending) {
        layoutSavePending = false;
        scheduleLayoutSave(50);
      }
    }
  }

  function scheduleLayoutSave(ms = 400) {
    clearTimeout(layoutSaveTimer);
    layoutSaveTimer = setTimeout(() => {
      persistLayoutNow();
    }, ms);
  }

  function buildLayoutJson() {
    if (!manager || !layoutInput) return;
    const cats = [...manager.querySelectorAll(".cat-item")].map((li) => li.dataset.cat || "").filter(Boolean);
    const channels = {};
    manager.querySelectorAll(".cat-item").forEach((item) => {
      const cat = item.dataset.cat || "Other";
      const panel = item.querySelector(".cat-panel");
      if (!panel) return;
      channels[cat] = [...panel.querySelectorAll(".ch-row")]
        .map((tr) => Number(tr.dataset.id))
        .filter(Boolean);
    });
    // Also include closed categories as empty lists so order is preserved
    cats.forEach((cat) => {
      if (!(cat in channels)) channels[cat] = [];
    });
    layoutInput.value = JSON.stringify({ cats, channels });
  }

  async function moveRowToCategory(row, newCat) {
    if (!row || !manager) return;
    const cat = (newCat || "Other").trim() || "Other";
    const fromItem = row.closest(".cat-item");
    const fromCat = fromItem?.dataset.cat || "";
    if (fromCat === cat && fromItem?.querySelector(".cat-panel")?.contains(row)) {
      return;
    }
    let toItem = findCatItem(cat);
    if (!toItem) toItem = createCatItemShell(cat);
    const tbody = await ensureCategoryOpen(toItem);
    if (!tbody) return;
    tbody.appendChild(row);
    row.dataset.category = cat;
    const sel = row.querySelector(".cat-select");
    if (sel) {
      if (![...sel.options].some((o) => o.value === cat)) {
        const opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = cat;
        sel.appendChild(opt);
      }
      sel.value = cat;
    }
    renumber(tbody);
    updateCatCount(toItem);
    if (fromItem && fromItem !== toItem) {
      renumber(fromItem.querySelector(".selected-body"));
      updateCatCount(fromItem);
    }
    ensureCatOption(cat);
    syncCatOrder();
  }

  function renumber(tbody) {
    if (!tbody) return;
    [...tbody.querySelectorAll("tr")].forEach((tr, i) => {
      const pos = tr.querySelector(".pos");
      if (pos) pos.textContent = String(i + 1);
    });
  }

  function updateCatCount(item) {
    if (!item) return;
    const countEl = item.querySelector(".cat-toggle .count");
    const n = item.querySelectorAll(".ch-row").length;
    if (countEl) countEl.textContent = String(n);
  }

  function updateYourListTotal(delta) {
    const h2 = document.querySelector("#channels-main-form .panel-head h2");
    if (!h2) return;
    const m = h2.textContent.match(/Your list \((\d+)\)/);
    if (!m) return;
    const next = Math.max(0, Number(m[1]) + delta);
    h2.textContent = `Your list (${next})`;
  }

  function updateSourceRemaining(delta) {
    const span =
      document.getElementById("source-remaining-label") ||
      document.querySelector("#add-from-source .panel-head h2 .muted.small");
    if (!span) return;
    const m = span.textContent.match(/\((\d+) remaining of (\d+)\)/);
    if (!m) return;
    const rem = Math.max(0, Number(m[1]) + delta);
    span.textContent = `(${rem} remaining of ${m[2]})`;
  }

  function setSourceRemainingLabel(remaining, total) {
    const span = document.getElementById("source-remaining-label");
    if (!span) return;
    span.textContent = `(${remaining} remaining of ${total})`;
  }

  function sourcePanel() {
    return document.getElementById("add-from-source");
  }

  function chipName(el) {
    if (!el) return "";
    const host = el.closest?.(".cat-chip") || el;
    if (host.dataset?.srcCat) return String(host.dataset.srcCat).trim();
    if (el.dataset?.srcCat) return String(el.dataset.srcCat).trim();
    return String(el.childNodes[0]?.textContent || "").trim();
  }

  function activeSrcCat() {
    const panel = sourcePanel();
    if (panel?.dataset.srcCat) return panel.dataset.srcCat;
    const chip = document.querySelector("#source-cat-chips .cat-chip.is-active");
    if (chip) return chipName(chip);
    return manager?.dataset.srcCat || "";
  }

  function selectedSourceCats() {
    return [...document.querySelectorAll("#source-cat-chips .source-cat-pick:checked")]
      .map((el) => String(el.value || "").trim())
      .filter(Boolean);
  }

  function syncSourceCatChipState(chip) {
    if (!chip) return;
    const cb = chip.querySelector(".source-cat-pick");
    chip.classList.toggle("is-checked", Boolean(cb?.checked));
  }

  function updateSourceCatCount() {
    const all = [...document.querySelectorAll("#source-cat-chips .source-cat-pick")];
    const n = all.filter((c) => c.checked).length;
    const countEl = document.getElementById("source-cat-pick-count");
    const head = document.getElementById("select-all-source-cats");
    if (countEl) {
      countEl.textContent =
        n === 1 ? "1 category selected" : `${n} categories selected`;
    }
    if (head) {
      head.checked = all.length > 0 && n === all.length;
      head.indeterminate = n > 0 && n < all.length;
    }
    all.forEach((cb) => syncSourceCatChipState(cb.closest(".cat-chip")));
  }

  function setAllSourceCats(on) {
    document.querySelectorAll("#source-cat-chips .source-cat-pick").forEach((cb) => {
      cb.checked = on;
      syncSourceCatChipState(cb.closest(".cat-chip"));
    });
    // Mirror onto visible channel rows for the active category
    const active = activeSrcCat();
    if (active) {
      picks().forEach((c) => {
        const row = c.closest("tr");
        const cat = (row?.dataset.category || "").trim() || "Other";
        if (cat === active) c.checked = on;
      });
      updateSourceCount();
    }
    updateSourceCatCount();
  }

  function bumpSourceChip(category, delta) {
    const cat = (category || "Other").trim() || "Other";
    const chips = document.getElementById("source-cat-chips");
    if (!chips) return;
    let chip = [...chips.querySelectorAll(".cat-chip")].find(
      (el) => chipName(el) === cat
    );
    if (!chip && delta > 0) {
      chip = document.createElement("div");
      chip.className = "cat-chip";
      chip.dataset.srcCat = cat;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "source-cat-pick";
      cb.name = "src_cats";
      cb.value = cat;
      cb.title = `Select category “${cat}” to add`;
      cb.setAttribute("aria-label", `Select ${cat}`);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cat-chip-filter";
      btn.dataset.srcCat = cat;
      btn.appendChild(document.createTextNode(cat + " "));
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = "0";
      btn.appendChild(count);
      chip.appendChild(cb);
      chip.appendChild(btn);
      chips.appendChild(chip);
    }
    if (!chip) return;
    const countEl = chip.querySelector(".count");
    if (!countEl) return;
    const next = Math.max(0, Number(countEl.textContent || 0) + delta);
    countEl.textContent = String(next);
    if (next === 0) chip.remove();
    updateSourceCatCount();
  }

  function picks() {
    return [...document.querySelectorAll(".source-pick")].filter((c) => {
      const row = c.closest("tr");
      return row && !row.hidden;
    });
  }

  function updateSourceCount() {
    const all = picks();
    const n = all.filter((c) => c.checked).length;
    const countEl = document.getElementById("source-pick-count");
    const head = document.getElementById("select-all-source-head");
    if (countEl) countEl.textContent = n + " selected";
    if (head) {
      head.checked = all.length > 0 && n === all.length;
      head.indeterminate = n > 0 && n < all.length;
    }
  }

  function wireSourcePick(input) {
    if (!input || input.dataset.bound) return;
    input.dataset.bound = "1";
    input.addEventListener("change", updateSourceCount);
  }

  function prependSourceRow(ch) {
    if (!ch || !ch.restorable) return;
    // Debounce: category delete may call this many times
    clearTimeout(prependSourceRow._timer);
    prependSourceRow._timer = setTimeout(() => {
      refreshSourcePreview({ silent: true });
    }, 40);
  }

  function updateLogoPreview(row) {
    const logoInput = row.querySelector(".ch-logo-input");
    const btn = row.querySelector(".logo-edit-btn");
    if (!logoInput || !btn) return;
    const url = logoInput.value.trim();
    row.dataset.logo = url;
    if (url) {
      btn.innerHTML = `<img class="ch-logo logo-preview" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.classList.add('is-broken');this.removeAttribute('src')">`;
    } else {
      btn.innerHTML = `<span class="ch-logo ch-logo-empty logo-preview" aria-hidden="true"></span>`;
    }
  }

  function markPanelClean(panel) {
    if (!panel) return;
    panel.querySelectorAll("input, select, textarea").forEach((el) => {
      if (el.type === "hidden") return;
      if (el.type === "checkbox" || el.type === "radio") {
        el.defaultChecked = el.checked;
      } else if (el.tagName === "SELECT") {
        [...el.options].forEach((opt) => {
          opt.defaultSelected = opt.selected;
        });
      } else {
        el.defaultValue = el.value;
      }
    });
  }

  function wirePanel(panel) {
    if (!panel) return;
    markPanelClean(panel);
    panel.querySelectorAll(".ch-row").forEach((row) => wireChannelRow(row));
    const tbody = panel.querySelector(".selected-body");
    if (tbody) {
      tbody.addEventListener("dragover", onChannelListDragOver);
      tbody.addEventListener("drop", onChannelListDrop);
    }
  }

  function caretAtEnd(input) {
    if (!input || typeof input.setSelectionRange !== "function") return;
    const move = () => {
      const len = input.value.length;
      try {
        input.setSelectionRange(len, len);
      } catch {
        /* ignore */
      }
    };
    requestAnimationFrame(move);
  }

  function wireSelectableInput(input, onChange) {
    if (!input || input.dataset.selectBound) return;
    input.dataset.selectBound = "1";
    input.addEventListener("mousedown", (e) => e.stopPropagation());
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("focus", () => caretAtEnd(input));
    input.addEventListener("keydown", (e) => e.stopPropagation());
    if (onChange) input.addEventListener("change", onChange);
  }

  function wireChannelRow(row) {
    if (!row || row.dataset.dndBound) return;
    row.dataset.dndBound = "1";
    row.removeAttribute("draggable");
    const handle = row.querySelector(".ch-drag");
    if (handle) {
      handle.setAttribute("draggable", "true");
      handle.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        dragRow = row;
        dragCat = null;
        row.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/channel", row.dataset.id || "");
        try {
          e.dataTransfer.setDragImage(row, 28, 20);
        } catch {
          /* ignore */
        }
      });
      handle.addEventListener("dragend", () => {
        row.classList.remove("is-dragging");
        dragRow = null;
        manager && manager.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
      });
    }

    wireSelectableInput(row.querySelector(".ch-name-input"), () => {
      const nameInput = row.querySelector(".ch-name-input");
      row.dataset.name = nameInput?.value.trim() || "";
      persistChannelFields(row);
    });
    wireSelectableInput(row.querySelector(".ch-tvg-input"), () => {
      const tvgInput = row.querySelector(".ch-tvg-input");
      row.dataset.tvgId = tvgInput?.value.trim() || "";
      persistChannelFields(row);
    });

    const catSel = row.querySelector(".cat-select");
    if (catSel && !catSel.dataset.catMoveBound) {
      catSel.dataset.catMoveBound = "1";
      catSel.addEventListener("change", async () => {
        const prev = row.dataset.category || row.closest(".cat-item")?.dataset.cat || "Other";
        const next = (catSel.value || "Other").trim() || "Other";
        if (next === prev) return;
        try {
          await apiPost(`/playlists/${playlistId()}/channels/api/update`, {
            id: Number(row.dataset.id),
            category: next,
          });
          await moveRowToCategory(row, next);
          scheduleLayoutSave(100);
        } catch (err) {
          catSel.value = prev;
          await appAlert(err.message || "Could not change category");
        }
      });
    }
  }

  async function persistChannelFields(row) {
    if (!row?.dataset.id) return;
    const id = Number(row.dataset.id);
    if (!id) return;
    const body = {
      id,
      custom_name: row.querySelector(".ch-name-input")?.value.trim() || "",
      source_tvg_id: row.querySelector(".ch-tvg-input")?.value.trim() || "",
      source_url: row.querySelector(".ch-url-input")?.value.trim() || row.dataset.url || "",
      source_logo: row.querySelector(".ch-logo-input")?.value.trim() || row.dataset.logo || "",
      category:
        row.querySelector(".cat-select")?.value ||
        row.dataset.category ||
        row.closest(".cat-item")?.dataset.cat ||
        "Other",
    };
    try {
      await apiPost(`/playlists/${playlistId()}/channels/api/update`, body);
      flashDbSaved("Channel saved");
    } catch (err) {
      console.error(err);
    }
  }

  function wireCategoryItem(item) {
    if (!item || item.dataset.catDndBound) return;
    item.dataset.catDndBound = "1";
    const handle = item.querySelector(".cat-drag");
    if (!handle) return;
    handle.setAttribute("draggable", "true");

    handle.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      dragCat = item;
      dragRow = null;
      item.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/category", item.dataset.cat || "");
      try {
        e.dataTransfer.setDragImage(item, 28, 20);
      } catch {
        /* ignore */
      }
    });
    handle.addEventListener("dragend", () => {
      item.classList.remove("is-dragging");
      dragCat = null;
      manager.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
    });
  }

  function onChannelListDragOver(e) {
    if (!dragRow) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const tbody = e.currentTarget;
    const over = e.target.closest("tr.ch-row");
    tbody.querySelectorAll(".drop-before, .drop-after").forEach((el) => {
      el.classList.remove("drop-before", "drop-after");
    });
    if (over && over !== dragRow) {
      const rect = over.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      over.classList.add(before ? "drop-before" : "drop-after");
    }
  }

  function onChannelListDrop(e) {
    if (!dragRow) return;
    e.preventDefault();
    e.stopPropagation();
    const tbody = e.currentTarget;
    const item = tbody.closest(".cat-item");
    const cat = item?.dataset.cat || "Other";
    const over = e.target.closest("tr.ch-row");
    tbody.querySelectorAll(".drop-before, .drop-after").forEach((el) => {
      el.classList.remove("drop-before", "drop-after");
    });

    const fromItem = dragRow.closest(".cat-item");
    if (over && over !== dragRow) {
      const rect = over.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      if (before) tbody.insertBefore(dragRow, over);
      else tbody.insertBefore(dragRow, over.nextSibling);
    } else if (!tbody.contains(dragRow)) {
      tbody.appendChild(dragRow);
    }

    const sel = dragRow.querySelector(".cat-select");
    if (sel) {
      if (![...sel.options].some((o) => o.value === cat)) {
        const opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = cat;
        sel.appendChild(opt);
      }
      sel.value = cat;
    }
    renumber(tbody);
    updateCatCount(item);
    if (fromItem && fromItem !== item) {
      renumber(fromItem.querySelector(".selected-body"));
      updateCatCount(fromItem);
    }
    syncCatOrder();
  }

  async function openCategory(item, { forceOpen = false } = {}) {
    if (!manager || !item || loading) return;
    const name = item.dataset.cat || "";

    if (item.classList.contains("is-open") && !forceOpen) {
      item.classList.remove("is-open");
      const toggle = item.querySelector(".cat-toggle");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
      const panel = item.querySelector(".cat-panel");
      if (panel) panel.remove();
      return;
    }
    if (item.classList.contains("is-open") && item.querySelector(".cat-panel")) return;

    loading = true;
    item.classList.add("is-loading");
    showLoading("Loading category…");
    try {
      const pid = manager.dataset.playlistId;
      const qs = new URLSearchParams({ cat: name });
      const res = await fetch(`/playlists/${pid}/channels/panel?` + qs.toString(), {
        headers: { Accept: "text/html", "X-Requested-With": "fetch" },
      });
      if (!res.ok) throw new Error("Failed to load category");
      const html = await res.text();
      const old = item.querySelector(".cat-panel");
      if (old) old.remove();
      item.classList.add("is-open");
      const toggle = item.querySelector(".cat-toggle");
      if (toggle) toggle.setAttribute("aria-expanded", "true");
      item.insertAdjacentHTML("beforeend", html);
      wirePanel(item.querySelector(".cat-panel"));
      manager.querySelectorAll(".cat-item").forEach((li) => {
        if (li.dataset.cat) ensureCatOption(li.dataset.cat);
      });
    } catch (err) {
      console.error(err);
      appAlert("Could not open category. Try again.");
    } finally {
      item.classList.remove("is-loading");
      loading = false;
      hideLoading();
    }
  }

  async function ensureCategoryOpen(item) {
    if (!item) return null;
    if (!item.classList.contains("is-open") || !item.querySelector(".cat-panel")) {
      await openCategory(item, { forceOpen: true });
    }
    return item.querySelector(".selected-body");
  }

  function findCatItem(name) {
    if (!manager) return null;
    return [...manager.querySelectorAll(".cat-item")].find(
      (li) => (li.dataset.cat || "") === name
    );
  }

  function ensureCatOption(name) {
    if (!name) return;
    const sel = document.getElementById("new-ch-category");
    if (sel && ![...sel.options].some((o) => o.value === name)) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
    manager?.querySelectorAll(".cat-select").forEach((selEl) => {
      if (![...selEl.options].some((o) => o.value === name)) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        selEl.appendChild(opt);
      }
    });
  }

  function createCatItemShell(name) {
    const pid = playlistId();
    const wiz = manager?.dataset.wizard === "1";
    const src = manager?.dataset.srcCat || "";
    const li = document.createElement("li");
    li.className = "cat-item";
    li.dataset.cat = name;
    const qs = new URLSearchParams();
    if (wiz) qs.set("wizard", "1");
    qs.set("cat", name);
    if (src) qs.set("src_cat", src);
    li.innerHTML = `
      <div class="cat-head">
        <span class="drag-handle cat-drag" draggable="true" title="Drag to reorder category" aria-label="Drag category">⠿</span>
        <a class="cat-toggle" href="/playlists/${esc(pid)}/channels?${qs.toString()}" aria-expanded="false">
          <span class="cat-chevron" aria-hidden="true"></span>
          <span class="cat-title">${esc(name)}</span>
          <span class="count">0</span>
        </a>
        <input type="text" class="cat-rename-input" value="${esc(name)}" data-old="${esc(name)}" title="Rename category" aria-label="Rename category">
        <button type="button" class="btn btn-danger btn-cat-delete" data-cat="${esc(name)}" title="Delete category and all its channels">Delete</button>
      </div>`;
    manager.appendChild(li);
    wireCategoryItem(li);
    ensureCatOption(name);
    syncCatOrder();
    return li;
  }

  async function deleteChannelRow(row) {
    const id = Number(row.dataset.id);
    if (!id) return;
    const ok = await appConfirm(
      "Delete this channel? It will appear under Add from source so you can add it again.",
      { title: "Delete channel", okLabel: "Delete" }
    );
    if (!ok) return;
    showLoading("Deleting…");
    try {
      const data = await apiPost(`/playlists/${playlistId()}/channels/api/delete`, { id });
      const item = row.closest(".cat-item");
      row.remove();
      if (item) {
        const tbody = item.querySelector(".selected-body");
        renumber(tbody);
        updateCatCount(item);
        if (!item.querySelector(".ch-row")) {
          item.remove();
          syncCatOrder();
        }
      }
      updateYourListTotal(-1);
      if (data.channel) {
        data.channel.restorable = true;
        prependSourceRow(data.channel);
      }
    } catch (err) {
      await appAlert(err.message || "Could not delete channel");
    } finally {
      hideLoading();
    }
  }

  async function deleteCategory(item) {
    const cat = item?.dataset.cat || "";
    if (!cat) return;
    const ok = await appConfirm(
      `Delete category “${cat}” and all its channels? They will appear under Add from source.`,
      { title: "Delete category", okLabel: "Delete" }
    );
    if (!ok) return;
    showLoading("Deleting category…");
    try {
      const data = await apiPost(`/playlists/${playlistId()}/channels/api/delete-category`, {
        category: cat,
      });
      const n = (data.channels || []).length;
      item.remove();
      syncCatOrder();
      updateYourListTotal(-n);
      (data.channels || []).forEach((ch) => {
        ch.restorable = true;
        prependSourceRow(ch);
      });
    } catch (err) {
      await appAlert(err.message || "Could not delete category");
    } finally {
      hideLoading();
    }
  }

  async function renameCategory(input) {
    const item = input.closest(".cat-item");
    const from = input.dataset.old || item?.dataset.cat || "";
    const to = input.value.trim();
    if (!item || !from || !to || from === to) {
      if (item && from) input.value = from;
      return;
    }
    showLoading("Renaming…");
    try {
      await apiPost(`/playlists/${playlistId()}/channels/api/rename-category`, { from, to });
      item.dataset.cat = to;
      input.dataset.old = to;
      input.value = to;
      const title = item.querySelector(".cat-title");
      if (title) title.textContent = to;
      const delBtn = item.querySelector(".btn-cat-delete");
      if (delBtn) delBtn.dataset.cat = to;
      item.querySelectorAll(".cat-select").forEach((sel) => {
        if (![...sel.options].some((o) => o.value === to)) {
          const opt = document.createElement("option");
          opt.value = to;
          opt.textContent = to;
          sel.appendChild(opt);
        }
        sel.value = to;
      });
      ensureCatOption(to);
      syncCatOrder();
    } catch (err) {
      input.value = from;
      await appAlert(err.message || "Could not rename category");
    } finally {
      hideLoading();
    }
  }

  async function createCategory() {
    const name = document.getElementById("new-cat-name")?.value.trim() || "";
    if (!name) {
      await appAlert("Category name is required");
      return;
    }
    ensureCatOption(name);
    const chSel = document.getElementById("new-ch-category");
    if (chSel) chSel.value = name;
    if (!manager) {
      document.getElementById("new-cat-name").value = "";
      return;
    }
    const existing = findCatItem(name);
    if (existing) {
      await openCategory(existing, { forceOpen: true });
      document.getElementById("new-cat-name").value = "";
      return;
    }
    const item = createCatItemShell(name);
    document.getElementById("new-cat-name").value = "";
    await openCategory(item, { forceOpen: true });
  }

  async function createChannel() {
    const name = document.getElementById("new-ch-name")?.value.trim() || "";
    const category =
      document.getElementById("new-ch-category")?.value.trim() || "Other";
    const url = document.getElementById("new-ch-url")?.value.trim() || "";
    const logo = document.getElementById("new-ch-logo")?.value.trim() || "";
    const tvg_id = document.getElementById("new-ch-tvg")?.value.trim() || "";
    if (!name) {
      await appAlert("Name is required");
      return;
    }
    if (!url) {
      await appAlert("Stream URL is required");
      return;
    }
    showLoading("Adding channel…");
    try {
      const data = await apiPost(`/playlists/${playlistId()}/channels/api/create`, {
        name,
        category,
        url,
        logo,
        tvg_id,
      });
      if (!manager) {
        const wiz = new URLSearchParams(location.search).get("wizard");
        const qs = new URLSearchParams();
        if (wiz) qs.set("wizard", wiz);
        qs.set("cat", data.channel.category);
        qs.set("msg", "Channel+added");
        location.href = `/playlists/${playlistId()}/channels?${qs.toString()}`;
        return;
      }
      let item = findCatItem(data.channel.category);
      if (!item) item = createCatItemShell(data.channel.category);
      await refreshCategory(item);
      updateCatCount(item);
      updateYourListTotal(1);
      document.getElementById("new-ch-name").value = "";
      document.getElementById("new-ch-url").value = "";
      document.getElementById("new-ch-logo").value = "";
      document.getElementById("new-ch-tvg").value = "";
    } catch (err) {
      await appAlert(err.message || "Could not create channel");
    } finally {
      hideLoading();
    }
  }

  function onManagerDragOver(e) {
    if (!dragCat && !dragRow) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const item = e.target.closest(".cat-item");
    manager.querySelectorAll(".cat-item.drop-target").forEach((el) => {
      if (el !== item) el.classList.remove("drop-target");
    });
    if (item && ((dragCat && dragCat !== item) || dragRow)) {
      item.classList.add("drop-target");
    }
  }

  async function onManagerDrop(e) {
    const item = e.target.closest(".cat-item");
    if (!item) return;
    item.classList.remove("drop-target");

    if (dragCat && dragCat !== item) {
      e.preventDefault();
      e.stopPropagation();
      const rect = item.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      if (before) manager.insertBefore(dragCat, item);
      else manager.insertBefore(dragCat, item.nextSibling);
      syncCatOrder();
      dragCat = null;
      return;
    }

    if (dragRow) {
      e.preventDefault();
      e.stopPropagation();
      const tbody = await ensureCategoryOpen(item);
      if (!tbody) return;
      const fromItem = dragRow.closest(".cat-item");
      if (e.target.closest("tr.ch-row") && tbody.contains(e.target.closest("tr.ch-row"))) {
        /* channel list drop handler will run */
      } else {
        tbody.appendChild(dragRow);
        const cat = item.dataset.cat || "Other";
        const sel = dragRow.querySelector(".cat-select");
        if (sel) {
          if (![...sel.options].some((o) => o.value === cat)) {
            const opt = document.createElement("option");
            opt.value = cat;
            opt.textContent = cat;
            sel.appendChild(opt);
          }
          sel.value = cat;
        }
        renumber(tbody);
        updateCatCount(item);
        if (fromItem && fromItem !== item) {
          renumber(fromItem.querySelector(".selected-body"));
          updateCatCount(fromItem);
        }
        syncCatOrder();
      }
    }
  }

  if (manager) {
    const initial = manager.querySelector(".cat-item.is-open .cat-panel");
    if (initial) wirePanel(initial);
    manager.querySelectorAll(".cat-item").forEach(wireCategoryItem);

    manager.addEventListener("click", (e) => {
      if (e.target.closest(".cat-rename-input, .btn-cat-delete, .btn-ch-delete, .btn-edit-stream, .logo-edit-btn")) {
        /* handled below / separately */
      } else {
        const toggle = e.target.closest(".cat-toggle");
        if (toggle && manager.contains(toggle)) {
          e.preventDefault();
          openCategory(toggle.closest(".cat-item"));
          return;
        }
      }

      const editStream = e.target.closest(".btn-edit-stream");
      if (editStream && manager.contains(editStream)) {
        e.preventDefault();
        openUrlEditor(editStream.closest(".ch-row"), "stream");
        return;
      }

      const editLogo = e.target.closest(".logo-edit-btn");
      if (editLogo && manager.contains(editLogo)) {
        e.preventDefault();
        openUrlEditor(editLogo.closest(".ch-row"), "logo");
        return;
      }

      const delCh = e.target.closest(".btn-ch-delete");
      if (delCh && manager.contains(delCh)) {
        e.preventDefault();
        deleteChannelRow(delCh.closest(".ch-row"));
        return;
      }

      const delCat = e.target.closest(".btn-cat-delete");
      if (delCat && manager.contains(delCat)) {
        e.preventDefault();
        deleteCategory(delCat.closest(".cat-item"));
        return;
      }

      const bulkAll = e.target.closest(".bulk-delete-all");
      if (bulkAll && manager.contains(bulkAll)) {
        e.preventDefault();
        const item = bulkAll.closest(".cat-item");
        if (item) deleteCategory(item);
        return;
      }
    });

    manager.addEventListener("keydown", (e) => {
      const input = e.target.closest(".cat-rename-input");
      if (!input || !manager.contains(input)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
    });

    manager.addEventListener("focusout", (e) => {
      const input = e.target.closest?.(".cat-rename-input");
      if (input && manager.contains(input)) renameCategory(input);
    });

    manager.addEventListener("dragover", onManagerDragOver);
    manager.addEventListener("drop", onManagerDrop);

    syncCatOrder();
  }

  const createBtn = document.getElementById("create-channel-btn");
  if (createBtn) createBtn.addEventListener("click", createChannel);
  const createBox = document.getElementById("create-channel-box");
  if (createBox) {
    createBox.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createChannel();
      }
    });
  }

  const createCatBtn = document.getElementById("create-category-btn");
  if (createCatBtn) createCatBtn.addEventListener("click", createCategory);
  const createCatBox = document.getElementById("create-category-box");
  if (createCatBox) {
    createCatBox.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createCategory();
      }
    });
  }

  document.querySelectorAll(".js-confirm-form").forEach((f) => {
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = f.dataset.confirm || "Are you sure?";
      const ok = await appConfirm(msg, { title: "Confirm", okLabel: "Continue" });
      if (!ok) return;
      f.submit();
    });
  });
  document.querySelectorAll(".js-confirm-submit").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const msg = btn.dataset.confirm || "Are you sure?";
      const ok = await appConfirm(msg, { title: "Confirm", okLabel: "Continue" });
      if (!ok) return;
      const formId = btn.getAttribute("form");
      const target = formId ? document.getElementById(formId) : btn.form;
      if (target) target.requestSubmit ? target.requestSubmit() : target.submit();
    });
  });

  let urlEditRow = null;
  let urlEditMode = "stream";
  const urlDialog = document.getElementById("url-edit-dialog");
  const urlForm = document.getElementById("url-edit-form");

  function openUrlEditor(row, mode) {
    if (!row || !urlDialog) return;
    urlEditRow = row;
    urlEditMode = mode === "logo" ? "logo" : "stream";
    const titleEl = document.getElementById("url-edit-title");
    const labelEl = document.getElementById("url-edit-field-label");
    const nameEl = document.getElementById("url-edit-channel-name");
    const valueEl = document.getElementById("url-edit-value");
    if (nameEl) {
      nameEl.textContent =
        row.querySelector(".ch-name-input")?.value || row.dataset.name || "Channel";
    }
    if (urlEditMode === "logo") {
      if (titleEl) titleEl.textContent = "Icon URL";
      if (labelEl) labelEl.textContent = "Icon URL";
      if (valueEl) {
        valueEl.value = row.querySelector(".ch-logo-input")?.value || row.dataset.logo || "";
        valueEl.placeholder = "https://…/logo.png";
      }
    } else {
      if (titleEl) titleEl.textContent = "Stream URL";
      if (labelEl) labelEl.textContent = "Stream URL";
      if (valueEl) {
        valueEl.value = row.querySelector(".ch-url-input")?.value || row.dataset.url || "";
        valueEl.placeholder = "https://…/stream.m3u8";
      }
    }
    urlDialog.showModal();
    if (valueEl) {
      valueEl.focus();
      valueEl.select();
    }
  }

  async function applyUrlEditor() {
    if (!urlEditRow) return;
    const value = document.getElementById("url-edit-value")?.value.trim() || "";
    if (urlEditMode === "logo") {
      const logoHidden = urlEditRow.querySelector(".ch-logo-input");
      if (logoHidden) logoHidden.value = value;
      urlEditRow.dataset.logo = value;
      updateLogoPreview(urlEditRow);
    } else {
      const urlHidden = urlEditRow.querySelector(".ch-url-input");
      if (urlHidden) urlHidden.value = value;
      urlEditRow.dataset.url = value;
      const streamBtn = urlEditRow.querySelector(".btn-edit-stream");
      if (streamBtn) streamBtn.classList.toggle("is-empty", !value);
    }
    await persistChannelFields(urlEditRow);
  }

  async function copyInputById(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.focus();
    el.select();
    try {
      await navigator.clipboard.writeText(el.value || "");
    } catch {
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
    }
  }

  if (urlDialog && urlForm) {
    urlForm.addEventListener("submit", async (e) => {
      const submitter = e.submitter;
      const value = submitter && submitter.value ? submitter.value : "cancel";
      if (value === "ok") await applyUrlEditor();
      urlEditRow = null;
      if (window.IptvLoading) window.IptvLoading.hideAll();
    });
    urlDialog.addEventListener("close", () => {
      if (window.IptvLoading) window.IptvLoading.hideAll();
    });
    urlDialog.addEventListener("click", (e) => {
      if (e.target === urlDialog) {
        urlDialog.close("cancel");
        urlEditRow = null;
      }
    });
    urlDialog.querySelectorAll(".btn-copy-field").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        copyInputById(btn.dataset.target);
      });
    });
  }

  const importBtn = document.getElementById("import-csv-btn");
  const importForm = document.getElementById("import-csv-form");
  const csvInput = document.getElementById("csv-file-input");
  if (importBtn && csvInput) {
    importBtn.addEventListener("click", () => csvInput.click());
    csvInput.addEventListener("change", () => {
      if (!csvInput.files || !csvInput.files.length) return;
      showLoading("Importing CSV…");
      if (importForm) importForm.submit();
    });
  }

  if (form) {
    form.addEventListener("submit", () => {
      syncCatOrder();
      buildLayoutJson();
      showLoading("Saving…");
    });
  }

  document.querySelectorAll(".quality-form, .inline-form").forEach((f) => {
    f.addEventListener("submit", () => showLoading("Working…"));
  });

  const sourceAddForm = document.getElementById("source-add-form");
  if (sourceAddForm) {
    sourceAddForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const selected = [...document.querySelectorAll(".source-pick:checked")].filter(
        (c) => {
          const row = c.closest("tr");
          return row && !row.hidden;
        }
      );
      const cats = selectedSourceCats();
      if (!selected.length && !cats.length) {
        await appAlert("Select at least one channel or category to add.");
        return;
      }
      const scrollY = window.scrollY;
      const keepScroll = () => window.scrollTo(0, scrollY);
      showLoading("Adding…");
      try {
        const wizard =
          sourcePanel()?.dataset.wizard === "1" ||
          new URLSearchParams(location.search).get("wizard") === "1";
        const data = await apiPost(`/playlists/${playlistId()}/channels/add`, {
          pick: selected.map((el) => el.value),
          src_cats: cats,
          wizard: wizard ? "1" : "",
          cat: manager?.querySelector(".cat-item.is-open")?.dataset.cat || "",
          src_cat: activeSrcCat(),
        });
        const channels = data.channels || [];
        updateYourListTotal(channels.length);
        const byCat = new Map();
        for (const ch of channels) {
          const cat = (ch.category || "Other").trim() || "Other";
          byCat.set(cat, (byCat.get(cat) || 0) + 1);
        }
        for (const [cat, n] of byCat) {
          let item = findCatItem(cat);
          if (!item) item = createCatItemShell(cat);
          if (item.classList.contains("is-open")) {
            await refreshCategory(item);
          } else {
            const countEl = item.querySelector(".cat-toggle .count");
            if (countEl) {
              countEl.textContent = String(Number(countEl.textContent || 0) + n);
            }
          }
        }
        await refreshSourcePreview({ silent: true });
        let flash = document.getElementById("source-add-flash");
        if (!flash) {
          flash = document.createElement("p");
          flash.id = "source-add-flash";
          flash.className = "ok-msg";
          sourceAddForm.prepend(flash);
        }
        flash.textContent = `Added ${data.added || channels.length} channel(s)`;
        clearTimeout(flash._timer);
        flash._timer = setTimeout(() => {
          flash.remove();
        }, 2500);
      } catch (err) {
        await appAlert(err.message || "Could not add channels");
      } finally {
        hideLoading();
        keepScroll();
        requestAnimationFrame(keepScroll);
      }
    });
  }

  function setAll(on) {
    picks().forEach((c) => {
      c.checked = on;
    });
    updateSourceCount();
  }

  function wireSourceToolbar() {
    const btnAll = document.getElementById("select-all-source");
    const btnNone = document.getElementById("select-none-source");
    const headEl = document.getElementById("select-all-source-head");
    if (btnAll && !btnAll.dataset.bound) {
      btnAll.dataset.bound = "1";
      btnAll.addEventListener("click", () => setAll(true));
    }
    if (btnNone && !btnNone.dataset.bound) {
      btnNone.dataset.bound = "1";
      btnNone.addEventListener("click", () => setAll(false));
    }
    if (headEl && !headEl.dataset.bound) {
      headEl.dataset.bound = "1";
      headEl.addEventListener("change", () => setAll(headEl.checked));
    }
    picks().forEach(wireSourcePick);
    updateSourceCount();
  }

  wireSourceToolbar();

  let sourcePreviewAbort = null;
  let sourcePreviewSeq = 0;
  let sourceSearchTimer = null;

  function syncSourceUrlState(q, srcCat) {
    try {
      const url = new URL(location.href);
      const v = String(q || "").trim();
      if (v) url.searchParams.set("q", v);
      else url.searchParams.delete("q");
      if (srcCat) url.searchParams.set("src_cat", srcCat);
      url.hash = "add-from-source";
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch {
      /* ignore */
    }
  }

  function renderSourceChips(counts, activeCat) {
    const chips = document.getElementById("source-cat-chips");
    if (!chips) return;
    const kept = new Set(selectedSourceCats());
    chips.innerHTML = "";
    (counts || []).forEach(([name, count]) => {
      const wrap = document.createElement("div");
      wrap.className = "cat-chip" + (name === activeCat ? " is-active" : "");
      wrap.dataset.srcCat = name;

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "source-cat-pick";
      cb.name = "src_cats";
      cb.value = name;
      cb.checked = kept.has(name);
      cb.title = `Select category “${name}” to add`;
      cb.setAttribute("aria-label", `Select ${name}`);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cat-chip-filter";
      btn.dataset.srcCat = name;
      btn.appendChild(document.createTextNode(name + " "));
      const span = document.createElement("span");
      span.className = "count";
      span.textContent = String(count);
      btn.appendChild(span);

      wrap.appendChild(cb);
      wrap.appendChild(btn);
      chips.appendChild(wrap);
      syncSourceCatChipState(wrap);
    });
    updateSourceCatCount();
  }

  function renderSourceRows(channels) {
    const mount = document.getElementById("source-list-mount");
    if (!mount) return;
    const panel = sourcePanel();
    const srcCat = panel?.dataset.srcCat || activeSrcCat() || "";
    const list = Array.isArray(channels) ? channels : [];

    if (!list.length) {
      mount.innerHTML = `<p class="muted" id="source-empty-msg">No remaining channels in this source category.</p>`;
      return;
    }

    const rows = list
      .map((s) => {
        const key = `${s.tvg_id || ""}||${s.url || ""}`;
        const logoHtml = s.logo
          ? `<img class="ch-logo" src="${esc(s.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.classList.add('is-broken');this.removeAttribute('src')">`
          : `<span class="ch-logo ch-logo-empty" aria-hidden="true"></span>`;
        return `<tr class="source-row" data-tvg-id="${esc(s.tvg_id || "")}" data-url="${esc(s.url || "")}" data-category="${esc(s.category || "")}">
            <td><input type="checkbox" class="source-pick" name="pick" value="${esc(key)}"></td>
            <td class="logo-cell">${logoHtml}</td>
            <td class="selectable-text">${esc(s.name || "")}</td>
            <td><span class="quality-badge q-${esc(s.quality || "other")} selectable-text">${esc(s.quality || "other")}</span></td>
            <td class="muted small selectable-text">${esc(s.category || "—")}</td>
            <td class="muted small mono selectable-text">${esc(s.tvg_id || "—")}</td>
            <td class="muted small selectable-text">${esc(s.group || "")}</td>
          </tr>`;
      })
      .join("");

    mount.innerHTML = `
    <h3 class="cat-heading"><span id="source-cat-heading">${esc(srcCat)}</span> <span class="muted small" id="source-cat-count">(${list.length})</span></h3>
    <div class="actions toolbar-secondary">
      <button type="button" class="btn btn-secondary" id="select-all-source">Select all</button>
      <button type="button" class="btn btn-secondary" id="select-none-source">Select none</button>
      <span class="muted small" id="source-pick-count">0 selected</span>
    </div>
    <div class="table-wrap source-list">
      <table>
        <thead>
          <tr>
            <th><input type="checkbox" id="select-all-source-head" title="Select all"></th>
            <th class="col-logo" aria-label="Logo"></th>
            <th>Name</th>
            <th>Quality</th>
            <th>Category</th>
            <th>tvg-id</th>
            <th>Group</th>
          </tr>
        </thead>
        <tbody id="source-list-body">${rows}</tbody>
      </table>
    </div>
    <div class="actions source-add-actions" style="margin-top:1rem">
      <button type="submit" class="btn">Add selected</button>
    </div>`;
    wireSourceToolbar();
    // If this category is checked for bulk add, select its visible channels too
    if (srcCat && selectedSourceCats().includes(srcCat)) {
      setAll(true);
    }
  }

  async function refreshSourcePreview(opts = {}) {
    const pid = playlistId();
    const panel = sourcePanel();
    if (!pid || !panel) return;

    const q =
      opts.q != null
        ? String(opts.q)
        : document.getElementById("source-search-input")?.value || "";
    const srcCat =
      opts.srcCat != null ? String(opts.srcCat) : panel.dataset.srcCat || "";

    if (sourcePreviewAbort) sourcePreviewAbort.abort();
    const ac = new AbortController();
    sourcePreviewAbort = ac;
    const seq = ++sourcePreviewSeq;

    const qs = new URLSearchParams();
    if (q.trim()) qs.set("q", q.trim());
    if (srcCat) qs.set("src_cat", srcCat);

    try {
      const res = await fetch(
        `/playlists/${pid}/channels/source-preview?${qs.toString()}`,
        {
          headers: { Accept: "application/json", "X-Requested-With": "fetch" },
          signal: ac.signal,
        }
      );
      const data = await res.json();
      if (seq !== sourcePreviewSeq) return;
      if (!res.ok || !data.ok) throw new Error(data.error || "Search failed");

      const active = data.active_src_cat || srcCat || "";
      panel.dataset.srcCat = active;
      const srcCatInput = document.getElementById("source-search-src-cat");
      const addSrcCat = document.getElementById("source-add-src-cat");
      if (srcCatInput) srcCatInput.value = active;
      if (addSrcCat) addSrcCat.value = active;

      renderSourceChips(data.source_cat_counts || [], active);
      renderSourceRows(data.channels || []);

      if (!String(data.q || "").trim()) {
        setSourceRemainingLabel(
          Number(data.source_remaining) || 0,
          Number(data.source_total) || 0
        );
      }

      if (!opts.silent) syncSourceUrlState(data.q || q, active);
    } catch (err) {
      if (err?.name === "AbortError") return;
      if (!opts.silent) {
        const mount = document.getElementById("source-list-mount");
        if (mount) {
          mount.innerHTML = `<p class="err">${esc(err.message || "Search failed")}</p>`;
        }
      }
    }
  }

  const searchForm = document.getElementById("source-search-form");
  const searchInput = document.getElementById("source-search-input");
  if (searchForm && searchInput) {
    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      clearTimeout(sourceSearchTimer);
      refreshSourcePreview({ q: searchInput.value });
    });
    searchInput.addEventListener("input", () => {
      clearTimeout(sourceSearchTimer);
      sourceSearchTimer = setTimeout(() => {
        refreshSourcePreview({ q: searchInput.value });
      }, 200);
    });
  }

  const chipsEl = document.getElementById("source-cat-chips");
  if (chipsEl) {
    chipsEl.addEventListener("click", (e) => {
      const filterBtn = e.target.closest(".cat-chip-filter");
      if (filterBtn && chipsEl.contains(filterBtn)) {
        e.preventDefault();
        const cat = chipName(filterBtn);
        if (!cat) return;
        const panel = sourcePanel();
        if (panel) panel.dataset.srcCat = cat;
        refreshSourcePreview({ srcCat: cat });
        return;
      }
    });
    chipsEl.addEventListener("change", (e) => {
      const cb = e.target.closest(".source-cat-pick");
      if (!cb || !chipsEl.contains(cb)) return;
      const cat = String(cb.value || "").trim();
      syncSourceCatChipState(cb.closest(".cat-chip"));
      // When viewing this category, mirror selection onto channel rows
      if (cat && cat === activeSrcCat()) {
        picks().forEach((c) => {
          c.checked = cb.checked;
        });
        updateSourceCount();
      }
      updateSourceCatCount();
    });
  }

  function wireSourceCatToolbar() {
    const allCats = document.getElementById("select-all-source-cats");
    const clearCats = document.getElementById("clear-source-cats");
    if (allCats && !allCats.dataset.bound) {
      allCats.dataset.bound = "1";
      allCats.addEventListener("change", () => setAllSourceCats(allCats.checked));
    }
    if (clearCats && !clearCats.dataset.bound) {
      clearCats.dataset.bound = "1";
      clearCats.addEventListener("click", () => setAllSourceCats(false));
    }
    updateSourceCatCount();
  }

  wireSourceCatToolbar();

  // If page loaded with ?q=, hydrate via API so results aren't limited to one category DOM
  if (searchInput?.value.trim()) {
    refreshSourcePreview({ q: searchInput.value, silent: true });
  }
})();
