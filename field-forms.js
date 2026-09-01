(() => {
  const cfg = window.APP_CONFIG || {};
  const db = window.ToolkitOfflineDB;
  const engine = window.ToolkitFormEngine;
  const loading = document.getElementById("field-forms-loading");
  const app = document.getElementById("field-forms-app");
  let client = null, user = null, profile = null, rotation = null, dynamicForms = [];
  const safe = engine.safe;

  const initials = name => String(name).split(/[\s._-]+/).filter(Boolean).slice(0,2)
    .map(v => v[0]?.toUpperCase()).join("") || "UP";

  function updateNetworkUI() {
    const online = navigator.onLine;
    document.getElementById("network-status-dot").classList.toggle("online", online);
    document.getElementById("network-status-text").textContent = online ? "Online" : "Offline";
    document.getElementById("network-status-copy").textContent = online
      ? "Assigned forms can refresh and queued drafts can synchronize."
      : "Cached forms and drafts remain available on this device.";
  }

  async function loadProfile() {
    if (window.supabase?.createClient && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      const { data: sessionData } = await client.auth.getSession();
      user = sessionData?.session?.user || null;

      if (user && navigator.onLine) {
        const [{ data: p }, { data: rot }] = await Promise.all([
          client.from("profiles").select("email,full_name,status,role,batch,year_level").eq("id", user.id).maybeSingle(),
          client.from("rotation_assignments").select("id,community_id,course_code,rotation_type,batch,status,communities(name,province)")
            .eq("user_id", user.id).eq("status", "active").order("created_at", { ascending: false }).limit(1)
        ]);
        if (p) { profile = p; await db.setSetting("cached_profile", p); }
        if (rot?.[0]) { rotation = rot[0]; await db.setSetting("cached_rotation", rotation); }
      }
    }

    if (!profile) profile = await db.getSetting("cached_profile");
    if (!rotation) rotation = await db.getSetting("cached_rotation");

    if (!profile) {
      if (!navigator.onLine) {
        loading.innerHTML = `<strong>Open Field Forms once while online</strong><span>An authorized Toolkit session must be cached on this device before offline fieldwork.</span><a href="index.html">Return to sign in</a>`;
        throw new Error("No cached profile");
      }
      location.replace("index.html"); throw new Error("No profile");
    }
    if (profile.status && profile.status !== "active") {
      location.replace("portal.html"); throw new Error("Inactive profile");
    }

    const name = profile.full_name || profile.email || "Toolkit user";
    document.querySelectorAll("[data-user-name]").forEach(x => x.textContent = name);
    document.querySelectorAll("[data-user-email]").forEach(x => x.textContent = profile.email || "");
    document.querySelectorAll("[data-user-initials]").forEach(x => x.textContent = initials(name));
    document.querySelectorAll("[data-sign-out]").forEach(btn => btn.addEventListener("click", async () => {
      if (client) await client.auth.signOut();
      location.replace("index.html");
    }));
  }

  async function loadDynamicForms() {
    dynamicForms = await engine.fetchAvailableForms(client, db);
    const target = document.getElementById("dynamic-form-library");
    const chip = document.getElementById("dynamic-form-cache-chip");

    if (!dynamicForms.length) {
      target.innerHTML = `<div class="table-empty">No additional published forms are assigned to your current community/course/batch yet.</div>`;
      chip.textContent = navigator.onLine ? "No assigned forms" : "Offline cache";
      return;
    }

    target.innerHTML = dynamicForms.map(form => `
      <a class="dynamic-form-card" href="dynamic-form.html?version_id=${encodeURIComponent(form.version_id)}">
        <div class="dynamic-form-card-icon">▤</div>
        <div><span class="dynamic-form-category">${safe(form.category || "SHS form")}</span>
          <strong>${safe(form.title)}</strong>
          <p>${safe(form.description || "Community fieldwork form")}</p>
          <small>${safe(form.form_code)} · ${safe(form.version_label || `Version ${form.version_number}`)} · Offline-ready</small>
        </div>
        <span class="dynamic-form-card-arrow">→</span>
      </a>`).join("");
    chip.textContent = `${dynamicForms.length} cached form${dynamicForms.length === 1 ? "" : "s"}`;
  }

  function hrefFor(r) {
    return r.dynamic_form_version_id
      ? `dynamic-form.html?version_id=${encodeURIComponent(r.dynamic_form_version_id)}&local_id=${encodeURIComponent(r.local_uuid)}`
      : `household-survey.html?local_id=${encodeURIComponent(r.local_uuid)}`;
  }

  async function renderLocalList() {
    const rows = await db.getAllSubmissions();
    document.getElementById("local-draft-count").textContent = String(rows.filter(r => r.form_status === "draft").length);
    document.getElementById("pending-sync-count").textContent = String(rows.filter(r => ["pending","error"].includes(r.sync_status)).length);
    document.getElementById("synced-local-count").textContent = String(rows.filter(r => r.sync_status === "synced").length);

    const target = document.getElementById("local-survey-list");
    if (!rows.length) {
      target.innerHTML = `<div class="table-empty">No field forms saved on this device yet.</div>`; return;
    }

    target.innerHTML = rows.map(r => {
      const isDynamic = !!r.dynamic_form_version_id;
      const title = isDynamic ? (r.form_title || r.form_code || "Field form") : (r.household_number || "Household Survey draft");
      const loc = isDynamic ? (r.community_name || "Community not recorded")
        : ([r.barangay, r.zone].filter(Boolean).join(" · ") || "Barangay/zone not entered");
      return `<a class="local-survey-row" href="${hrefFor(r)}">
        <div><span class="local-survey-status sync-${safe(r.sync_status || "pending")}">${safe((r.sync_status || "pending").replaceAll("_"," "))}</span>
          <strong>${safe(title)}</strong><small>${safe(loc)} · ${safe(r.form_status || "draft")}</small></div>
        <div class="local-survey-meta"><small>${r.updated_at ? new Date(r.updated_at).toLocaleString() : ""}</small></div>
        <span class="local-survey-arrow">→</span></a>`;
    }).join("");
  }

  async function syncAll() {
    if (!navigator.onLine) return alert("No internet connection yet. Your drafts remain safely stored on this device.");
    if (!client || !user) return alert("Your online Toolkit session is unavailable. Sign in again before syncing.");

    const btn = document.getElementById("sync-all-btn");
    btn.disabled = true; btn.textContent = "Syncing…";

    const rows = await db.getAllSubmissions();
    let errors = 0;
    for (const row of rows.filter(r => r.dynamic_form_version_id && r.sync_status !== "synced")) {
      try { await engine.syncDynamicRecord({ client, db, record: row }); }
      catch (error) {
        errors++;
        await db.putSubmission({ ...row, sync_status:"error", last_error:error.message || String(error), updated_at:new Date().toISOString() });
      }
    }

    const refreshed = await db.getAllSubmissions();
    if (refreshed.some(r => r.form_code === "SHS-HH-2023" && r.sync_status !== "synced")) {
      location.href = "household-survey.html?sync_all=1"; return;
    }

    await renderLocalList();
    btn.disabled = false; btn.textContent = "Sync Now";
    if (errors) alert(`${errors} dynamic form record(s) could not sync yet. They remain saved on this device.`);
  }

  async function init() {
    try {
      updateNetworkUI();
      window.addEventListener("online", updateNetworkUI);
      window.addEventListener("offline", updateNetworkUI);
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
      await db.openDB(); await loadProfile(); await loadDynamicForms(); await renderLocalList();
      document.getElementById("sync-all-btn").addEventListener("click", syncAll);
      loading.hidden = true; app.hidden = false; document.body.classList.remove("portal-is-loading");
    } catch (err) { console.error("[Field Forms]", err); }
  }
  init();
})();