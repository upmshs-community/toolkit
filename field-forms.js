(() => {
  const cfg = window.APP_CONFIG || {};
  const db = window.ToolkitOfflineDB;
  const loading = document.getElementById("field-forms-loading");
  const app = document.getElementById("field-forms-app");
  let client = null;
  let user = null;
  let profile = null;

  const safe = (v = "") => String(v)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");

  function initials(name = "") {
    return String(name).split(/[\s._-]+/).filter(Boolean).slice(0,2).map(v => v[0]?.toUpperCase()).join("") || "UP";
  }

  function updateNetworkUI() {
    const online = navigator.onLine;
    document.getElementById("network-status-dot").classList.toggle("online", online);
    document.getElementById("network-status-text").textContent = online ? "Online" : "Offline";
    document.getElementById("network-status-copy").textContent = online
      ? "Queued drafts can be synchronized."
      : "New and existing drafts remain available on this device.";
  }

  async function loadProfile() {
    if (!window.supabase?.createClient || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

    const { data: sessionData } = await client.auth.getSession();
    user = sessionData?.session?.user || null;

    if (!user && navigator.onLine) {
      const { data: userData } = await client.auth.getUser();
      user = userData?.user || null;
    }

    if (user && navigator.onLine) {
      const { data: p } = await client.from("profiles")
        .select("email,full_name,status,role,batch,year_level")
        .eq("id", user.id).maybeSingle();
      if (p) {
        profile = p;
        await db.setSetting("cached_profile", p);
      }
    }

    if (!profile) profile = await db.getSetting("cached_profile");

    if (!profile) {
      if (!navigator.onLine) {
        loading.innerHTML = `<strong>Open this form once while online</strong><span>An authorized Toolkit session must be cached on this device before offline fieldwork.</span><a href="index.html">Return to sign in</a>`;
        throw new Error("No cached profile");
      }
      location.replace("index.html");
      throw new Error("No profile");
    }

    if (profile.status && profile.status !== "active") {
      location.replace("portal.html");
      throw new Error("Inactive profile");
    }

    const name = profile.full_name || profile.email || "Toolkit user";
    document.querySelectorAll("[data-user-name]").forEach(x => x.textContent = name);
    document.querySelectorAll("[data-user-email]").forEach(x => x.textContent = profile.email || "");
    document.querySelectorAll("[data-user-initials]").forEach(x => x.textContent = initials(name));

    document.querySelectorAll("[data-sign-out]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (client) await client.auth.signOut();
        location.replace("index.html");
      });
    });
  }

  async function renderLocalList() {
    const rows = (await db.getAllSubmissions()).filter(r => r.form_code === "SHS-HH-2023");
    const drafts = rows.filter(r => r.form_status === "draft").length;
    const pending = rows.filter(r => r.sync_status === "pending" || r.sync_status === "error").length;
    const synced = rows.filter(r => r.sync_status === "synced").length;

    document.getElementById("local-draft-count").textContent = String(drafts);
    document.getElementById("pending-sync-count").textContent = String(pending);
    document.getElementById("synced-local-count").textContent = String(synced);

    const target = document.getElementById("local-survey-list");
    if (!rows.length) {
      target.innerHTML = `<div class="table-empty">No household surveys saved on this device yet.</div>`;
      return;
    }

    target.innerHTML = rows.map(r => `
      <a class="local-survey-row" href="household-survey.html?local_id=${encodeURIComponent(r.local_uuid)}">
        <div>
          <span class="local-survey-status sync-${safe(r.sync_status || "pending")}">${safe((r.sync_status || "pending").replaceAll("_"," "))}</span>
          <strong>${safe(r.household_number || "Household draft")}</strong>
          <small>${safe([r.barangay, r.zone].filter(Boolean).join(" · ") || "Barangay/zone not entered")} · ${safe(r.form_status || "draft")}</small>
        </div>
        <div class="local-survey-meta">
          <span>${r.has_location ? "📍 GPS" : "No GPS"}</span>
          <span>${r.has_photo ? "📷 Photo" : "No photo"}</span>
          <small>${r.updated_at ? new Date(r.updated_at).toLocaleString() : ""}</small>
        </div>
        <span class="local-survey-arrow">→</span>
      </a>
    `).join("");
  }

  async function syncAll() {
    if (!navigator.onLine) {
      alert("No internet connection yet. Your drafts remain safely stored on this device.");
      return;
    }
    location.href = "household-survey.html?sync_all=1";
  }

  async function init() {
    try {
      updateNetworkUI();
      window.addEventListener("online", updateNetworkUI);
      window.addEventListener("offline", updateNetworkUI);

      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
      }

      await db.openDB();
      await loadProfile();
      await renderLocalList();

      document.getElementById("sync-all-btn").addEventListener("click", syncAll);

      loading.hidden = true;
      app.hidden = false;
      document.body.classList.remove("portal-is-loading");
    } catch (err) {
      console.error("[Field Forms]", err);
    }
  }

  init();
})();
