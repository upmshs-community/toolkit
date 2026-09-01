(() => {
  const body = document.body;
  if (!body?.classList.contains("admin-sticky-sidebar-page")) return;

  const sidebar = document.getElementById("admin-sidebar");
  const toggle = document.querySelector(".admin-mobile-nav-toggle");
  if (!sidebar || !toggle) return;

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "admin-mobile-backdrop";
  backdrop.hidden = true;
  backdrop.setAttribute("aria-label", "Close administration menu");
  document.body.appendChild(backdrop);

  function isMobile() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function setOpen(open) {
    if (!isMobile()) open = false;

    body.classList.toggle("admin-nav-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    backdrop.hidden = !open;

    if (open) {
      const active = sidebar.querySelector("nav a.active");
      requestAnimationFrame(() => active?.scrollIntoView({ block: "nearest" }));
    }
  }

  toggle.addEventListener("click", () => {
    setOpen(!body.classList.contains("admin-nav-open"));
  });

  backdrop.addEventListener("click", () => setOpen(false));

  sidebar.addEventListener("click", event => {
    if (isMobile() && event.target.closest("a[href]")) setOpen(false);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") setOpen(false);
  });

  const media = window.matchMedia("(max-width: 900px)");
  const onBreakpointChange = () => setOpen(false);

  if (media.addEventListener) media.addEventListener("change", onBreakpointChange);
  else if (media.addListener) media.addListener(onBreakpointChange);
})();
