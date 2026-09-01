(() => {
  const body = document.body;
  if (!body?.classList.contains("portal-dashboard-page")) return;

  const toggle = document.querySelector(".portal-mobile-menu-toggle");
  const sidebar = document.getElementById("portal-mobile-sidebar");
  const mobileRoleActions = document.getElementById("portal-mobile-role-actions");
  const mobileSignout = document.getElementById("portal-mobile-signout");
  const account = document.querySelector(".portal-account");

  if (!toggle || !sidebar) return;

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "portal-mobile-backdrop";
  backdrop.hidden = true;
  backdrop.setAttribute("aria-label", "Close Toolkit menu");
  document.body.appendChild(backdrop);

  const isMobile = () => window.matchMedia("(max-width: 820px)").matches;

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
    const meta = [role, batch, year].filter(v => v && v !== "—").join(" · ") || role;

    document.querySelectorAll("[data-mobile-user-name]").forEach(el => {
      if (el.textContent !== name) el.textContent = name;
    });
    document.querySelectorAll("[data-mobile-user-initials]").forEach(el => {
      if (el.textContent !== initials) el.textContent = initials;
    });
    document.querySelectorAll("[data-mobile-user-meta]").forEach(el => {
      if (el.textContent !== meta) el.textContent = meta;
    });
  }

  function syncRoleActions() {
    if (!mobileRoleActions) return;

    const desired = [
      document.getElementById("review-link"),
      document.getElementById("knowledge-link"),
      document.getElementById("admin-link")
    ]
      .filter(source => source && !source.hidden)
      .map(source => ({ href: source.href, label: source.textContent.trim() }));

    const current = [...mobileRoleActions.querySelectorAll("a")]
      .map(anchor => ({ href: anchor.href, label: anchor.textContent.trim() }));

    const unchanged =
      desired.length === current.length &&
      desired.every((item, index) =>
        item.href === current[index]?.href &&
        item.label === current[index]?.label
      );

    if (unchanged) return;

    const fragment = document.createDocumentFragment();
    desired.forEach(item => {
      const anchor = document.createElement("a");
      anchor.href = item.href;
      anchor.textContent = item.label;
      fragment.appendChild(anchor);
    });
    mobileRoleActions.replaceChildren(fragment);
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
    if (isMobile() && event.target.closest("a[href]")) setOpen(false);
  });
  mobileSignout?.addEventListener("click", () => {
    document.querySelector(".portal-account [data-sign-out]")?.click();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") setOpen(false);
  });
  window.addEventListener("hashchange", () => setOpen(false));

  const breakpoint = window.matchMedia("(max-width: 820px)");
  const resetOnBreakpoint = () => setOpen(false);
  breakpoint.addEventListener?.("change", resetOnBreakpoint);

  // FIX: watch only the desktop account block. The drawer is outside this
  // subtree, so updating the drawer cannot recursively trigger this observer.
  if (account) {
    const observer = new MutationObserver(() => queueMicrotask(syncDrawer));
    observer.observe(account, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["hidden"]
    });
  }

  syncDrawer();
  setTimeout(syncDrawer, 250);
  setTimeout(syncDrawer, 900);
})();