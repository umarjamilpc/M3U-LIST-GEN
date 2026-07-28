(function () {
  const root = document.getElementById("user-menu");
  const btn = document.getElementById("user-menu-btn");
  const panel = document.getElementById("user-menu-panel");
  if (!root || !btn || !panel) return;

  function setOpen(open) {
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    root.classList.toggle("is-open", open);
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(panel.hidden);
  });

  document.addEventListener("click", (e) => {
    if (!root.contains(e.target)) setOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
})();
