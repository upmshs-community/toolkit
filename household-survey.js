(() => {
  const FORM_CODE = "SHS-HH-2023";
  const FORM_VERSION = "2023.1";
  const cfg = window.APP_CONFIG || {};
  const db = window.ToolkitOfflineDB;
  const form = document.getElementById("household-form");
  const loading = document.getElementById("household-loading");
  const app = document.getElementById("household-app");

  let client = null;
  let user = null;
  let profile = null;
  let rotation = null;
  let localId = new URLSearchParams(location.search).get("local_id") || crypto.randomUUID();
  let currentRecord = null;
  let photoObjectUrl = null;
  let saveTimer = null;

  const repeaters = [
    "family_members","breastfeeding","supplementary_feeding","nutrition_children",
    "immunization_children","illnesses","deaths","philhealth_members","covid_vaccines",
    "community_leaders","problems"
  ];

  const safe = (v = "") => String(v)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");

  function updateNetworkUI() {
    const online = navigator.onLine;
    document.getElementById("household-network-dot").classList.toggle("online", online);
    document.getElementById("household-network-text").textContent = online ? "Online" : "Offline";
  }

  async function getAuthContext() {
    if (window.supabase?.createClient && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      const { data: sessionData } = await client.auth.getSession();
      user = sessionData?.session?.user || null;

      if (user && navigator.onLine) {
        const { data: p } = await client.from("profiles")
          .select("email,full_name,status,role,batch,year_level")
          .eq("id", user.id).maybeSingle();
        if (p) {
          profile = p;
          await db.setSetting("cached_profile", p);
        }

        const { data: rot } = await client.from("rotation_assignments")
          .select("id,community_id,course_code,rotation_type,batch,status,communities(name,province)")
          .eq("user_id", user.id)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1);
        if (rot?.[0]) {
          rotation = rot[0];
          await db.setSetting("cached_rotation", rotation);
        }
      }
    }

    if (!profile) profile = await db.getSetting("cached_profile");
    if (!rotation) rotation = await db.getSetting("cached_rotation");

    if (!profile) {
      if (!navigator.onLine) {
        loading.innerHTML = `<strong>Offline session not prepared</strong><span>Open Field Forms once while signed in and online before going offline.</span><a href="index.html">Return to sign in</a>`;
        throw new Error("No cached profile");
      }
      location.replace("index.html");
      throw new Error("No profile");
    }

    if (profile.status && profile.status !== "active") {
      location.replace("portal.html");
      throw new Error("Inactive profile");
    }
  }

  function setupDecisionMatrix() {
    const target = document.getElementById("decision_matrix");
    const areas = ["Family Expenses","Health","Education","Participation in Community Activities"];
    const people = ["Father","Mother","Children","Single","Others"];
    target.innerHTML = areas.map((area, i) => `
      <tr>
        <th>${area}</th>
        ${people.map(p => `<td><input type="checkbox" name="decision_${i}" value="${p}"></td>`).join("")}
      </tr>
    `).join("");
  }

  function createRepeaterRow(type, data = {}) {
    const template = document.getElementById(`${type}_template`);
    const row = template.content.firstElementChild.cloneNode(true);
    row.dataset.repeaterType = type;
    row.querySelectorAll("[data-field]").forEach(el => {
      const key = el.dataset.field;
      if (data[key] !== undefined && data[key] !== null) el.value = data[key];
      el.addEventListener("input", scheduleSave);
      el.addEventListener("change", scheduleSave);
    });
    row.querySelector(".remove-row")?.addEventListener("click", () => {
      row.remove();
      scheduleSave();
    });
    document.getElementById(`${type}_rows`).appendChild(row);
  }

  function ensureStarterRows() {
    const minimums = {
      family_members: 1, breastfeeding: 1, supplementary_feeding: 1,
      nutrition_children: 1, immunization_children: 1, illnesses: 1,
      deaths: 1, philhealth_members: 1, covid_vaccines: 1,
      community_leaders: 1, problems: 3
    };
    for (const [type, count] of Object.entries(minimums)) {
      const target = document.getElementById(`${type}_rows`);
      if (!target.children.length) {
        for (let i = 0; i < count; i++) createRepeaterRow(type);
      }
    }
  }

  function collectRepeater(type) {
    return [...document.querySelectorAll(`#${type}_rows [data-repeater-type="${type}"]`)].map(row => {
      const obj = {};
      row.querySelectorAll("[data-field]").forEach(el => obj[el.dataset.field] = el.value);
      return obj;
    }).filter(obj => Object.values(obj).some(v => String(v || "").trim() !== ""));
  }

  function restoreRepeater(type, rows = []) {
    const target = document.getElementById(`${type}_rows`);
    target.innerHTML = "";
    rows.forEach(row => createRepeaterRow(type, row));
  }

  function collectFormData() {
    const data = {};
    const fd = new FormData(form);

    for (const [key, value] of fd.entries()) {
      if (data[key] === undefined) data[key] = value;
      else if (Array.isArray(data[key])) data[key].push(value);
      else data[key] = [data[key], value];
    }

    // Ensure checkbox groups that are empty are still represented predictably.
    const checkboxNames = [
      "livelihood","property_owned","appliances","transport","utilities","food_storage",
      "garbage_disposal","animal_management","delay_decision","delay_reaching","delay_receiving",
      "decision_0","decision_1","decision_2","decision_3"
    ];
    checkboxNames.forEach(name => {
      const checked = [...form.querySelectorAll(`input[type="checkbox"][name="${name}"]:checked`)].map(x => x.value);
      data[name] = checked;
    });

    repeaters.forEach(type => data[type] = collectRepeater(type));
    return data;
  }

  function restoreFormData(data = {}) {
    Object.entries(data).forEach(([name, value]) => {
      if (repeaters.includes(name)) return;
      const elements = [...form.querySelectorAll(`[name="${CSS.escape(name)}"]`)];
      if (!elements.length) return;

      if (elements[0].type === "checkbox") {
        const values = Array.isArray(value) ? value : [value];
        elements.forEach(el => el.checked = values.includes(el.value));
      } else if (elements[0].type === "radio") {
        elements.forEach(el => el.checked = el.value === value);
      } else {
        elements[0].value = value ?? "";
      }
    });

    repeaters.forEach(type => restoreRepeater(type, data[type] || []));
    ensureStarterRows();
  }

  function currentGps() {
    return currentRecord?.gps || null;
  }

  async function saveLocal(statusOverride = null) {
    const now = new Date().toISOString();
    const responses = collectFormData();
    const photo = await db.getMedia(`${localId}:household_photo`);

    const record = {
      ...(currentRecord || {}),
      local_uuid: localId,
      form_code: FORM_CODE,
      form_version: FORM_VERSION,
      form_status: statusOverride || currentRecord?.form_status || "draft",
      sync_status: "pending",
      server_id: currentRecord?.server_id || null,
      user_id: user?.id || currentRecord?.user_id || null,
      community_id: rotation?.community_id || currentRecord?.community_id || null,
      community_name: rotation?.communities?.name || currentRecord?.community_name || null,
      household_number: responses.household_number || "",
      interview_date: responses.interview_date || "",
      barangay: responses.barangay || "",
      zone: responses.zone || "",
      interviewer: responses.interviewer || "",
      responses,
      gps: currentRecord?.gps || null,
      has_location: !!currentRecord?.gps?.latitude,
      has_photo: !!photo?.blob,
      created_at: currentRecord?.created_at || now,
      updated_at: now,
      last_error: null
    };

    currentRecord = record;
    await db.putSubmission(record);
    updateSaveUI("Saved locally", "pending");
    return record;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    document.getElementById("autosave-status").textContent = "Saving…";
    saveTimer = setTimeout(() => saveLocal().catch(console.error), 450);
  }

  function updateSaveUI(text, state = "pending", detail = "") {
    document.getElementById("autosave-status").textContent = text;
    document.getElementById("bottom-save-status").textContent = text;
    document.getElementById("bottom-sync-detail").textContent = detail || (
      state === "synced" ? "Latest changes are synchronized to the Toolkit." :
      state === "error" ? "The draft remains safely stored on this device." :
      "This draft remains available on this device until synchronization succeeds."
    );
    const chip = document.getElementById("survey-sync-chip");
    chip.textContent = state === "synced" ? "Synced ✓" : state === "error" ? "Sync error" : "Saved locally";
    chip.className = `survey-sync-chip is-${state}`;
  }

  function updateGpsUI() {
    const gps = currentGps();
    const target = document.getElementById("gps-readout");
    if (!gps?.latitude) {
      target.textContent = "No location captured.";
      return;
    }
    target.innerHTML = `
      <strong>Location captured ✓</strong>
      <span>${Number(gps.latitude).toFixed(6)}, ${Number(gps.longitude).toFixed(6)}</span>
      <small>Accuracy: ${gps.accuracy ? `±${Math.round(gps.accuracy)} m` : "not reported"} · ${gps.captured_at ? new Date(gps.captured_at).toLocaleString() : ""}</small>
    `;
  }

  async function captureLocation() {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported on this device/browser.");
      return;
    }
    const btn = document.getElementById("capture-location-btn");
    btn.disabled = true;
    btn.textContent = "Getting location…";

    navigator.geolocation.getCurrentPosition(async pos => {
      currentRecord = currentRecord || {};
      currentRecord.gps = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        altitude: pos.coords.altitude,
        captured_at: new Date().toISOString()
      };
      updateGpsUI();
      await saveLocal();
      btn.disabled = false;
      btn.textContent = "📍 Retake GPS Location";
    }, err => {
      alert(`Unable to capture location: ${err.message}`);
      btn.disabled = false;
      btn.textContent = "📍 Capture GPS Location";
    }, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0
    });
  }

  async function savePhoto(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      alert("Please use a photo under 8 MB.");
      return;
    }
    await db.putMedia({
      local_media_id: `${localId}:household_photo`,
      local_uuid: localId,
      media_type: "household_reference",
      file_name: file.name || "household-reference.jpg",
      content_type: file.type || "image/jpeg",
      blob: file,
      updated_at: new Date().toISOString()
    });
    await renderPhoto();
    await saveLocal();
  }

  async function renderPhoto() {
    const media = await db.getMedia(`${localId}:household_photo`);
    const preview = document.getElementById("household-photo-preview");
    const remove = document.getElementById("remove-photo-btn");

    if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
    photoObjectUrl = null;

    if (!media?.blob) {
      preview.innerHTML = "No photo saved.";
      remove.hidden = true;
      return;
    }

    photoObjectUrl = URL.createObjectURL(media.blob);
    preview.innerHTML = `<img src="${photoObjectUrl}" alt="Saved household reference photo"><small>${safe(media.file_name || "Household reference photo")}</small>`;
    remove.hidden = false;
  }

  async function removePhoto() {
    await db.deleteMedia(`${localId}:household_photo`);
    await renderPhoto();
    await saveLocal();
  }

  async function loadTemplateId() {
    let templateId = await db.getSetting(`template_id:${FORM_CODE}`);
    if (templateId) return templateId;
    if (!client || !navigator.onLine) return null;

    const { data, error } = await client.from("field_form_templates")
      .select("id")
      .eq("code", FORM_CODE)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) {
      templateId = data.id;
      await db.setSetting(`template_id:${FORM_CODE}`, templateId);
    }
    return templateId;
  }

  async function syncRecord(record) {
    if (!navigator.onLine || !client) return false;

    const { data: sessionData } = await client.auth.getSession();
    const sessionUser = sessionData?.session?.user;
    if (!sessionUser) throw new Error("Your login session expired. Sign in again before syncing.");

    const templateId = await loadTemplateId();
    if (!templateId) throw new Error("Household survey template is not available on the server yet.");

    const payload = {
      template_id: templateId,
      local_uuid: record.local_uuid,
      community_id: record.community_id || null,
      submitted_by: sessionUser.id,
      status: record.form_status === "completed" ? "completed" : "draft",
      household_code: record.household_number || null,
      interview_date: record.interview_date || null,
      barangay: record.barangay || null,
      zone: record.zone || null,
      interviewer: record.interviewer || null,
      response_json: record.responses || {},
      latitude: record.gps?.latitude ?? null,
      longitude: record.gps?.longitude ?? null,
      gps_accuracy_m: record.gps?.accuracy ?? null,
      location_captured_at: record.gps?.captured_at ?? null,
      updated_at: new Date().toISOString()
    };

    const { data: serverRow, error } = await client.from("field_form_submissions")
      .upsert(payload, { onConflict: "local_uuid" })
      .select("id,local_uuid,status,photo_path")
      .single();
    if (error) throw error;

    let photoPath = serverRow.photo_path || null;
    const media = await db.getMedia(`${record.local_uuid}:household_photo`);

    if (media?.blob) {
      const ext = (media.file_name || "photo.jpg").split(".").pop().replace(/[^a-zA-Z0-9]/g,"") || "jpg";
      const path = `${sessionUser.id}/${serverRow.id}/household-reference.${ext}`;
      const body = await media.blob.arrayBuffer();
      const { error: uploadError } = await client.storage.from("field-media")
        .upload(path, body, {
          contentType: media.content_type || "image/jpeg",
          cacheControl: "3600",
          upsert: true
        });
      if (uploadError) throw uploadError;
      photoPath = path;

      const { error: updateError } = await client.from("field_form_submissions")
        .update({ photo_path: path, updated_at: new Date().toISOString() })
        .eq("id", serverRow.id);
      if (updateError) throw updateError;
    }

    const synced = {
      ...record,
      user_id: sessionUser.id,
      server_id: serverRow.id,
      sync_status: "synced",
      photo_path: photoPath,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_error: null
    };
    await db.putSubmission(synced);
    if (record.local_uuid === localId) currentRecord = synced;
    return true;
  }

  async function syncAllLocal() {
    if (!navigator.onLine) {
      updateSaveUI("Saved offline", "pending", "No internet connection. Sync will be retried later.");
      return;
    }

    updateSaveUI("Syncing…", "pending", "Uploading queued household surveys.");
    const rows = (await db.getAllSubmissions()).filter(r =>
      r.form_code === FORM_CODE && r.sync_status !== "synced"
    );

    let errors = 0;
    for (const row of rows) {
      try {
        await syncRecord(row);
      } catch (err) {
        errors++;
        await db.putSubmission({
          ...row,
          sync_status: "error",
          last_error: err.message || String(err),
          updated_at: new Date().toISOString()
        });
        console.error("[Household sync]", err);
      }
    }

    const refreshed = await db.getSubmission(localId);
    if (refreshed) currentRecord = refreshed;

    if (errors) updateSaveUI("Saved locally", "error", `${errors} record(s) could not sync yet. Nothing was deleted from this device.`);
    else updateSaveUI("Synced ✓", "synced");
  }

  async function loadRecord() {
    currentRecord = await db.getSubmission(localId);
    if (!currentRecord) {
      currentRecord = {
        local_uuid: localId,
        form_code: FORM_CODE,
        form_version: FORM_VERSION,
        form_status: "draft",
        sync_status: "pending",
        user_id: user?.id || null,
        community_id: rotation?.community_id || null,
        community_name: rotation?.communities?.name || null,
        responses: {
          interview_date: new Date().toISOString().slice(0,10),
          interviewer: profile?.full_name || profile?.email || ""
        },
        gps: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      await db.putSubmission(currentRecord);
    }

    restoreFormData(currentRecord.responses || {});
    updateGpsUI();
    await renderPhoto();
    document.getElementById("local-record-code").textContent = localId.slice(0,8).toUpperCase();

    if (rotation?.communities?.name) {
      document.getElementById("assigned-community-name").textContent =
        `${rotation.communities.name}${rotation.communities.province ? `, ${rotation.communities.province}` : ""}`;
      document.getElementById("assigned-rotation-meta").textContent =
        [rotation.course_code, rotation.rotation_type, rotation.batch].filter(Boolean).join(" · ");
    } else if (currentRecord.community_name) {
      document.getElementById("assigned-community-name").textContent = currentRecord.community_name;
    } else {
      document.getElementById("assigned-community-name").textContent = "No active rotation cached";
    }

    updateSaveUI(
      currentRecord.sync_status === "synced" ? "Synced ✓" : currentRecord.sync_status === "error" ? "Saved locally" : "Saved locally",
      currentRecord.sync_status || "pending",
      currentRecord.last_error || ""
    );
  }

  function attachEvents() {
    form.querySelectorAll("input,select,textarea").forEach(el => {
      if (el.closest("template")) return;
      el.addEventListener("input", scheduleSave);
      el.addEventListener("change", scheduleSave);
    });

    document.querySelectorAll(".add-row").forEach(btn => {
      btn.addEventListener("click", () => {
        createRepeaterRow(btn.dataset.repeater);
        scheduleSave();
      });
    });

    document.getElementById("capture-location-btn").addEventListener("click", captureLocation);
    document.getElementById("take-photo-btn").addEventListener("click", () => document.getElementById("household-photo-input").click());
    document.getElementById("household-photo-input").addEventListener("change", e => savePhoto(e.target.files?.[0]));
    document.getElementById("remove-photo-btn").addEventListener("click", removePhoto);

    document.getElementById("save-draft-btn").addEventListener("click", async () => {
      await saveLocal("draft");
      updateSaveUI("Draft saved locally", "pending");
    });

    document.getElementById("complete-queue-btn").addEventListener("click", async () => {
      const hh = form.elements.household_number.value.trim();
      const barangay = form.elements.barangay.value.trim();
      const interviewDate = form.elements.interview_date.value;
      if (!hh || !barangay || !interviewDate) {
        alert("Before marking complete, enter at least Household #, Date of Interview, and Barangay.");
        return;
      }
      await saveLocal("completed");
      updateSaveUI("Completed · waiting to sync", "pending");
      if (navigator.onLine) await syncAllLocal();
    });

    document.getElementById("sync-now-btn").addEventListener("click", async () => {
      await saveLocal();
      await syncAllLocal();
    });

    window.addEventListener("online", async () => {
      updateNetworkUI();
      try { await syncAllLocal(); } catch (err) { console.warn(err); }
    });
    window.addEventListener("offline", updateNetworkUI);

    window.addEventListener("beforeunload", () => {
      clearTimeout(saveTimer);
    });
  }

  async function init() {
    try {
      updateNetworkUI();
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
      }

      await db.openDB();
      setupDecisionMatrix();
      await getAuthContext();
      await loadRecord();
      ensureStarterRows();
      attachEvents();

      loading.hidden = true;
      app.hidden = false;
      document.body.classList.remove("portal-is-loading");

      if (new URLSearchParams(location.search).get("sync_all") === "1" && navigator.onLine) {
        await syncAllLocal();
      }
    } catch (err) {
      console.error("[Household Survey]", err);
      if (!loading.innerHTML.includes("Offline session")) {
        loading.innerHTML = `<strong>Unable to open household survey</strong><span>${safe(err.message || err)}</span><a href="field-forms.html">Return to Field Forms</a>`;
      }
    }
  }

  init();
})();
