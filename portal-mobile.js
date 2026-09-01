(() => {
  const body = document.body;
  if (!body?.classList.contains("portal-dashboard-page")) return;

  const toggle = document.querySelector(".portal-mobile-menu-toggle");
  const sidebar = document.getElementById("portal-mobile-sidebar");
  const mobileRoleActions = document.getElementById("portal-mobile-role-actions");
  const mobileSignout = document.getElementById("portal-mobile-signout");

  if (!toggle || !sidebar) return;

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "portal-mobile-backdrop";
  backdrop.hidden = true;
  backdrop.setAttribute("aria-label", "Close Toolkit menu");
  document.body.appendChild(backdrop);

  function isMobile() {
    return window.matchMedia("(max-width: 820px)").matches;
  }

  function setOpen(open) {
    if (!isMobile()) open = false;

    body.classList.toggle("portal-mobile-nav-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    backdrop.hidden = !open;

    if (open) {
      requestAnimationFrame(() => {
        sidebar.querySelector("nav a.active")?.scrollIntoView({ block: "nearest" });
      });
    }
  }

  function text(selector, fallback = "") {
    return document.querySelector(selector)?.textContent?.trim() || fallback;
  }

  function syncUser() {
    const name = text("[data-user-name]", "Toolkit user");
    const initials = text("[data-user-initials]", "UP");
    const role = text("[data-user-role]", "Student");
    const batch = text("[data-user-batch]", "");
    const year = text("[data-user-year]", "");

    document.querySelectorAll("[data-mobile-user-name]").forEach(el => {
      el.textContent = name;
    });
    document.querySelectorAll("[data-mobile-user-initials]").forEach(el => {
      el.textContent = initials;
    });
    document.querySelectorAll("[data-mobile-user-meta]").forEach(el => {
      el.textContent = [role, batch, year].filter(v => v && v !== "—").join(" · ") || role;
    });
  }

  function syncRoleActions() {
    if (!mobileRoleActions) return;

    const sources = [
      document.getElementById("review-link"),
      document.getElementById("knowledge-link"),
      document.getElementById("admin-link")
    ].filter(Boolean);

    mobileRoleActions.innerHTML = "";

    sources.forEach(source => {
      if (source.hidden) return;

      const anchor = document.createElement("a");
      anchor.href = source.href;
      anchor.textContent = source.textContent.trim();
      mobileRoleActions.appendChild(anchor);
    });
  }

  function syncDrawer() {
    syncUser();
    syncRoleActions();
  }

  toggle.addEventListener("click", () => {
    setOpen(!body.classList.contains("portal-mobile-nav-open"));
  });

  backdrop.addEventListener("click", () => setOpen(false));

  sidebar.addEventListener("click", event => {
    if (isMobile() && event.target.closest("a[href]")) {
      setOpen(false);
    }
  });

  mobileSignout?.addEventListener("click", () => {
    const original = document.querySelector(".portal-account [data-sign-out]");
    if (original) original.click();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") setOpen(false);
  });

  window.addEventListener("hashchange", () => setOpen(false));

  const breakpoint = window.matchMedia("(max-width: 820px)");
  const resetOnBreakpoint = () => setOpen(false);
  if (breakpoint.addEventListener) breakpoint.addEventListener("change", resetOnBreakpoint);
  else if (breakpoint.addListener) breakpoint.addListener(resetOnBreakpoint);

  /* portal.js fills the profile and role-gated links asynchronously.
     Observe those changes so the drawer always mirrors the correct role. */
  const observer = new MutationObserver(syncDrawer);
  observer.observe(document.getElementById("portal-app") || document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["hidden"]
  });

  syncDrawer();
  window.setTimeout(syncDrawer, 300);
  window.setTimeout(syncDrawer, 1000);
})();
