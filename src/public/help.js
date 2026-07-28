(function () {
  const pop = document.getElementById("help-pop");
  if (!pop) return;
  let openBtn = null;

  function hide() {
    pop.hidden = true;
    pop.textContent = "";
    openBtn = null;
  }

  function show(btn) {
    const text = btn.getAttribute("data-help") || "";
    if (!text) return;
    pop.textContent = text;
    pop.hidden = false;
    const r = btn.getBoundingClientRect();
    const pad = 8;
    let top = r.bottom + pad + window.scrollY;
    let left = r.left + window.scrollX;
    pop.style.top = top + "px";
    pop.style.left = left + "px";
    // keep on screen
    requestAnimationFrame(() => {
      const pr = pop.getBoundingClientRect();
      if (pr.right > window.innerWidth - 12) {
        pop.style.left = Math.max(12, window.innerWidth - pr.width - 12 + window.scrollX) + "px";
      }
      if (pr.bottom > window.innerHeight - 12) {
        pop.style.top = Math.max(12, r.top + window.scrollY - pr.height - pad) + "px";
      }
    });
    openBtn = btn;
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".help-btn");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      if (openBtn === btn && !pop.hidden) hide();
      else show(btn);
      return;
    }
    if (!pop.hidden && !e.target.closest("#help-pop")) hide();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
})();
