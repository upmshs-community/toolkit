
(() => {
  const cfg = window.APP_CONFIG || {};
  const url = cfg.SUPABASE_URL || "";
  const key = cfg.SUPABASE_ANON_KEY || "";
  const app = document.getElementById("portal-app");
  const loading = document.getElementById("portal-loading");

  let client;
  let currentUser = null;
  let currentProfile = null;
  let currentRotation = null;
  let communities = [];
  let projects = [];
  let handovers = [];
  let calendarEvents = [];
  let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedCalendarDate = null;

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function configMissing() {
    return !url || !key || url.includes("PASTE_YOUR") || key.includes("PASTE_YOUR");
  }

  function safe(value = "") {
    return String(value)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function prettyCommunityName(value = "") {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^alangalang$/i.test(raw)) return "Alang-alang";
    return raw;
  }

  function updatePhase6CurrentCommunity() {
    const link = currentRotation?.community_id
      ? `community.html?id=${encodeURIComponent(currentRotation.community_id)}`
      : "portal.html#communities";
    const communityName = currentRotation?.community_name || "Community Profile";
    const meta = currentRotation
      ? [currentRotation.rotation_type, currentRotation.course_code, currentRotation.batch].filter(Boolean).join(" · ") || "Open your assigned community profile."
      : "Open your assigned community profile.";

    document.querySelectorAll("[data-current-community-link]").forEach(el => {
      if (el.tagName === "A") el.setAttribute("href", link);
    });
    document.querySelectorAll("[data-current-community-name]").forEach(el => {
      el.textContent = communityName;
    });
    document.querySelectorAll("[data-current-rotation-meta]").forEach(el => {
      el.textContent = meta;
    });
  }

  function setLoadingCard({title, text, detail = "", action = ""}) {
    if (!loading) return;
    loading.hidden = false;
    loading.innerHTML = `
      <img src="assets/shs-logo.png" alt="UPM-SHS">
      <strong>${safe(title)}</strong>
      <span>${safe(text)}</span>
      ${detail ? `<small class="portal-status-detail">${safe(detail)}</small>` : ""}
      ${action}
    `;
  }

  async function signOut() {
    await client.auth.signOut();
    window.location.replace("index.html");
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
  }

  function communityCoverImage(name = "") {
    const normalized = String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, "");

    const covers = {
      alangalang: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Church_of_Alangalang%2C_Leyte.jpg",
      dagami: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Dagami_Town_Hall.jpg",
      dulag: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Church_of_Dulag%2C_Leyte.jpg",
      palo: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Palo_Municipal_Hall_%28Palo%2C_Leyte%3B_09-09-2022%29.jpg",
      tanauan: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Tanauan_%28Leyte%29_Church.jpg",
      tolosa: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Tolosa%2C_Leyte_from_air_%28Leyte%3B_09-08-2022%29.jpg"
    };

    return covers[normalized] || "";
  }

  function renderCommunities() {
    const target = document.getElementById("portal-communities");
    if (!target) return;
    if (!communities.length) {
      target.innerHTML = `<article><span>—</span><strong>No communities</strong><small>No data yet</small></article>`;
      return;
    }

    target.innerHTML = communities.map(c => {
      const displayName = prettyCommunityName(c.name);
      const cover = communityCoverImage(c.name);

      return `
        <a class="portal-community-link phase6-community-card-link"
           href="community.html?id=${encodeURIComponent(c.id)}">
          <article class="phase6-community-cover-card">
            <div
              class="phase6-community-cover"
              ${cover ? `style="background-image: linear-gradient(180deg, rgba(12,44,31,.03), rgba(12,44,31,.14)), url('${cover}')"` : ""}
              role="img"
              aria-label="${safe(displayName)} municipality">
            </div>

            <div class="phase6-community-card-body">
              <div>
                <strong>${safe(displayName)}</strong>
                <small>${safe(c.preceptor_name || c.province || "Learning site")}</small>
              </div>
              <span class="phase6-community-arrow" aria-hidden="true">→</span>
            </div>
          </article>
        </a>
      `;
    }).join("");
  }

  function renderProjects() {
    const target = document.getElementById("portal-projects");
    if (!target) return;

    if (!projects.length) {
      target.innerHTML = `
        <article class="project-portal-card">
          <h3>No projects yet</h3>
          <p>No project records are available for your current view.</p>
        </article>
      `;
      setText("dashboard-project-count", "0");
      setText("dashboard-project-detail", "No registered projects yet.");
      return;
    }

    target.innerHTML = projects.map(p => `
      <article class="project-portal-card">
        <div class="project-card-top">
          <span class="project-pill status-${safe(p.status)}">${safe((p.status || "").replaceAll("_"," "))}</span>
          <small>${safe(p.community_name || "")}</small>
        </div>
        <h3>${safe(p.title)}</h3>
        <p>${safe(p.summary || "No summary yet.")}</p>
        <div class="project-meta">
          <span>${safe(p.category || "General")}</span>
          <span>${safe(p.school_year || "—")}</span>
          <span>${safe(p.batch || "—")}</span>
        </div>
        <a class="mini-action save project-open-link" href="project.html?id=${encodeURIComponent(p.id)}">Open Project</a>
      </article>
    `).join("");

    setText("dashboard-project-count", String(projects.filter(p => ["active","for_handover","planning"].includes(p.status)).length));
    setText(
      "dashboard-project-detail",
      currentRotation ? `Projects linked to ${currentRotation.community_name}.` : "Showing accessible project records."
    );
  }

  function renderHandovers() {
    const target = document.getElementById("portal-handover-list");
    if (!target) return;

    if (!handovers.length) {
      target.innerHTML = `
        <article class="portal-handover-card">
          <strong>No handovers yet</strong>
          <span>No continuity notes are available yet for your current view.</span>
        </article>
      `;
      setText("dashboard-handover-count", "0");
      setText("dashboard-handover-detail", "No pending or recent handovers.");
      return;
    }

    target.innerHTML = handovers.map(h => `
      <article class="portal-handover-card">
        <div class="project-card-top">
          <span class="project-pill status-${safe(h.status)}">${safe((h.status || "").replaceAll("_"," "))}</span>
          <small>${safe(h.project_title)}</small>
        </div>
        <strong>${safe(h.community_name || "Community project")}</strong>
        <span>${safe(h.outgoing_batch ? `Outgoing batch: ${h.outgoing_batch}` : "Outgoing batch not specified")}</span>
        <p>${safe(h.pending_tasks || h.accomplishments || h.recommendations || "No summary text.")}</p>
      </article>
    `).join("");

    setText("dashboard-handover-count", String(handovers.filter(h => ["submitted","returned"].includes(h.status)).length));
    setText(
      "dashboard-handover-detail",
      currentRotation ? `Recent handovers for ${currentRotation.community_name}.` : "Showing accessible handover notes."
    );
  }

  function populatePortalHandoverProjects() {
    const select = document.getElementById("portal-handover-project");
    if (!select) return;
    select.innerHTML = `<option value="">Select project</option>` +
      projects.map(p => `<option value="${p.id}">${safe(p.title)} · ${safe(p.community_name || "")}</option>`).join("");
  }

  function setHandoverEligibility() {
    const note = document.getElementById("portal-handover-eligibility");
    const form = document.getElementById("portal-handover-form");
    if (!note || !form) return;

    const elevated = ["admin","coordinator","faculty","preceptor"].includes(currentProfile.role);
    const canSubmit = elevated || !!currentRotation;

    if (canSubmit && projects.length) {
      note.textContent = elevated
        ? "You may submit continuity notes for any listed project."
        : `You may submit continuity notes for projects in ${currentRotation.community_name}.`;
      form.hidden = false;
      document.getElementById("portal-handover-batch").value = currentProfile.batch || "";
    } else if (canSubmit && !projects.length) {
      note.textContent = "You have handover permission, but no project records are available yet.";
      form.hidden = true;
    } else {
      note.textContent = "A current community assignment is required before a student can submit a handover.";
      form.hidden = true;
    }
  }

  async function loadResourceCount() {
    const countEl = document.getElementById("dashboard-resource-count");
    const detailEl = document.getElementById("dashboard-resource-detail");

    const { count, error } = await client
      .from("toolkit_resources")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");

    if (error) {
      if (countEl) countEl.textContent = "—";
      if (detailEl) detailEl.textContent = "Approved resource count unavailable.";
      return;
    }

    if (countEl) countEl.textContent = String(count || 0);
    if (detailEl) {
      detailEl.textContent = count
        ? `${count} approved resource${count === 1 ? "" : "s"} available in the Library.`
        : "Resources are being prepared for publication.";
    }
  }

  async function loadCommunities() {
    const { data, error } = await client
      .from("communities")
      .select("id,name,province,municipality,preceptor_name,is_active")
      .eq("is_active", true)
      .order("name");
    if (!error) communities = data || [];
    renderCommunities();
  }

  async function loadCurrentRotation(userId) {
    const { data, error } = await client
      .from("rotation_assignments")
      .select(`
        id,community_id,course_code,rotation_type,batch,start_date,end_date,status,notes,
        communities(name,province,municipality,preceptor_name,description)
      `)
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);

    const summary = document.getElementById("current-rotation-summary");
    const communityEl = document.getElementById("dashboard-community");
    const detailEl = document.getElementById("dashboard-rotation-detail");

    if (error || !data?.length) {
      currentRotation = null;
      updatePhase6CurrentCommunity();
      if (summary) {
        summary.innerHTML = `
          <div class="portal-assignment-copy">
            <strong>No active rotation assigned yet.</strong>
            <span>Your coordinator can assign your community from the Admin portal.</span>
          </div>
          <span class="portal-assignment-arrow">View communities →</span>
        `;
      }
      if (communityEl) communityEl.textContent = "To be assigned";
      if (detailEl) detailEl.textContent = "No active rotation assignment yet.";
      return;
    }

    const rotation = data[0];
    currentRotation = {
      id: rotation.id,
      community_id: rotation.community_id,
      community_name: prettyCommunityName(rotation.communities?.name || "Assigned community"),
      preceptor_name: rotation.communities?.preceptor_name || "",
      course_code: rotation.course_code,
      rotation_type: rotation.rotation_type,
      batch: rotation.batch,
      start_date: rotation.start_date,
      end_date: rotation.end_date
    };

    updatePhase6CurrentCommunity();

    const details = [rotation.rotation_type, rotation.course_code, rotation.batch].filter(Boolean).join(" · ");
    if (communityEl) communityEl.textContent = currentRotation.community_name;
    if (detailEl) detailEl.textContent = details || "Active rotation";

    if (summary) {
      const preceptor = currentRotation.preceptor_name
        ? `<small>Preceptor: ${safe(currentRotation.preceptor_name)}</small>`
        : "";
      summary.innerHTML = `
        <div class="portal-assignment-copy">
          <span class="portal-label">Current assignment</span>
          <strong>${safe(currentRotation.community_name)}</strong>
          <span>${safe(details || "Active rotation")}</span>
          ${preceptor}
        </div>
        <span class="portal-assignment-arrow">Open community →</span>
      `;
    }
  }

  async function loadProjects() {
    let query = client
      .from("projects")
      .select(`
        id,community_id,title,category,summary,objectives,status,school_year,batch,start_date,end_date,created_at,
        communities(name,province)
      `)
      .order("created_at", { ascending: false });

    const elevated = ["admin","coordinator","faculty","preceptor"].includes(currentProfile.role);
    if (!elevated && currentRotation?.community_id) {
      query = query.eq("community_id", currentRotation.community_id);
    }

    const { data, error } = await query;
    if (error) {
      setText("dashboard-project-count", "—");
      setText("dashboard-project-detail", error.message);
      return;
    }

    projects = (data || []).map(p => ({
      ...p,
      community_name: prettyCommunityName(p.communities?.name || "Unknown community")
    }));
    renderProjects();
    populatePortalHandoverProjects();
    setHandoverEligibility();
  }

  async function loadHandovers() {
    let query = client
      .from("project_handovers")
      .select(`
        id,project_id,outgoing_batch,status,accomplishments,pending_tasks,recommendations,updated_at,
        projects(title,community_id,communities(name))
      `)
      .order("updated_at", { ascending: false })
      .limit(8);

    const elevated = ["admin","coordinator","faculty","preceptor"].includes(currentProfile.role);
    if (!elevated && currentRotation?.community_id) {
      query = query.eq("projects.community_id", currentRotation.community_id);
    }

    const { data, error } = await query;
    if (error) {
      setText("dashboard-handover-count", "—");
      setText("dashboard-handover-detail", error.message);
      return;
    }

    handovers = (data || []).map(h => ({
      ...h,
      project_title: h.projects?.title || "Unknown project",
      community_name: prettyCommunityName(h.projects?.communities?.name || "")
    }));
    renderHandovers();
  }


  function dateKey(value) {
    const d = value instanceof Date ? value : new Date(`${String(value).slice(0,10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function monthBounds(cursor = calendarCursor) {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    return { start: dateKey(start), end: dateKey(end) };
  }

  function calendarEventLink(event) {
    if (event.link_url) return event.link_url;
    if (event.lesson_id) return `lesson.html?id=${encodeURIComponent(event.lesson_id)}`;
    if (event.event_type === "rotation_start" || event.event_type === "rotation_end") {
      return currentRotation?.community_id
        ? `community.html?id=${encodeURIComponent(currentRotation.community_id)}`
        : "#rotation";
    }
    if (event.event_type === "project_due" && event.project_id) {
      return `project.html?id=${encodeURIComponent(event.project_id)}`;
    }
    return "";
  }

  function calendarTypeLabel(type = "") {
    const labels = {
      lms_due: "LMS",
      fieldwork: "Fieldwork",
      rotation: "Rotation",
      rotation_start: "Rotation",
      rotation_end: "Rotation",
      project: "Project",
      project_due: "Project",
      meeting: "Meeting",
      other: "Activity"
    };
    return labels[type] || "Activity";
  }

  function syntheticCalendarEvents() {
    const items = [];
    const { start, end } = monthBounds();

    if (currentRotation?.start_date &&
        currentRotation.start_date >= start &&
        currentRotation.start_date <= end) {
      items.push({
        id: `rotation-start-${currentRotation.id}`,
        title: `${currentRotation.community_name} rotation starts`,
        event_date: currentRotation.start_date,
        event_type: "rotation_start",
        description: [currentRotation.rotation_type, currentRotation.course_code].filter(Boolean).join(" · ")
      });
    }

    if (currentRotation?.end_date &&
        currentRotation.end_date >= start &&
        currentRotation.end_date <= end) {
      items.push({
        id: `rotation-end-${currentRotation.id}`,
        title: `${currentRotation.community_name} rotation ends`,
        event_date: currentRotation.end_date,
        event_type: "rotation_end",
        description: "Review outputs, continuity notes, and handover requirements."
      });
    }

    projects.forEach(project => {
      if (!project.end_date || project.end_date < start || project.end_date > end) return;
      items.push({
        id: `project-${project.id}`,
        project_id: project.id,
        title: `${project.title} target date`,
        event_date: project.end_date,
        event_type: "project_due",
        description: project.community_name || ""
      });
    });

    return items;
  }

  function eventSort(a, b) {
    const dateCompare = String(a.event_date || "").localeCompare(String(b.event_date || ""));
    if (dateCompare) return dateCompare;
    return String(a.start_time || "").localeCompare(String(b.start_time || ""));
  }

  function renderCalendarAgenda(date = null) {
    const target = document.getElementById("portal-calendar-agenda");
    const title = document.getElementById("portal-agenda-title");
    const showAll = document.getElementById("calendar-show-all");
    if (!target || !title) return;

    let list = [...calendarEvents].sort(eventSort);

    if (date) {
      list = list.filter(event => event.event_date === date);
      const selected = new Date(`${date}T00:00:00`);
      title.textContent = selected.toLocaleDateString(undefined, {
        weekday: "long", month: "long", day: "numeric"
      });
      if (showAll) showAll.hidden = false;
    } else {
      const today = dateKey(new Date());
      const isCurrentMonth =
        calendarCursor.getFullYear() === new Date().getFullYear() &&
        calendarCursor.getMonth() === new Date().getMonth();

      title.textContent = isCurrentMonth ? "Upcoming Activities" : "Activities This Month";
      if (isCurrentMonth) list = list.filter(event => event.event_date >= today);
      if (showAll) showAll.hidden = true;
    }

    if (!list.length) {
      target.innerHTML = `
        <div class="portal-agenda-empty">
          <strong>No scheduled activity${date ? " on this date" : ""}.</strong>
          <span>LMS deadlines and fieldwork activities will appear here once published.</span>
        </div>
      `;
      return;
    }

    target.innerHTML = list.slice(0, 8).map(event => {
      const d = new Date(`${event.event_date}T00:00:00`);
      const href = calendarEventLink(event);
      const content = `
        <div class="portal-agenda-date">
          <strong>${d.toLocaleDateString(undefined,{day:"2-digit"})}</strong>
          <span>${d.toLocaleDateString(undefined,{month:"short"})}</span>
        </div>
        <div class="portal-agenda-copy">
          <span class="portal-calendar-event-type type-${safe(event.event_type || "other")}">${safe(calendarTypeLabel(event.event_type))}</span>
          <strong>${safe(event.title)}</strong>
          ${event.description ? `<small>${safe(event.description)}</small>` : ""}
        </div>
        ${href ? '<span class="portal-agenda-arrow">→</span>' : ""}
      `;
      return href
        ? `<a class="portal-agenda-event" href="${safe(href)}">${content}</a>`
        : `<article class="portal-agenda-event">${content}</article>`;
    }).join("");
  }

  function renderCalendar() {
    const grid = document.getElementById("portal-calendar-grid");
    const label = document.getElementById("calendar-month-label");
    if (!grid || !label) return;

    label.textContent = calendarCursor.toLocaleDateString(undefined, {
      month: "long", year: "numeric"
    });

    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const today = dateKey(new Date());

    const eventsByDate = new Map();
    calendarEvents.forEach(event => {
      if (!eventsByDate.has(event.event_date)) eventsByDate.set(event.event_date, []);
      eventsByDate.get(event.event_date).push(event);
    });

    const cells = [];
    for (let i = 0; i < firstDay; i++) {
      cells.push('<div class="portal-calendar-day is-empty" aria-hidden="true"></div>');
    }

    for (let day = 1; day <= days; day++) {
      const key = dateKey(new Date(year, month, day));
      const dayEvents = eventsByDate.get(key) || [];
      const dots = dayEvents.slice(0, 3).map(event =>
        `<i class="calendar-dot type-${safe(event.event_type || "other")}"></i>`
      ).join("");

      cells.push(`
        <button class="portal-calendar-day
          ${key === today ? "is-today" : ""}
          ${selectedCalendarDate === key ? "is-selected" : ""}
          ${dayEvents.length ? "has-events" : ""}"
          type="button"
          data-calendar-date="${key}">
          <span>${day}</span>
          <small>${dayEvents.length ? `${dayEvents.length} ${dayEvents.length === 1 ? "item" : "items"}` : ""}</small>
          <div class="calendar-dots">${dots}</div>
        </button>
      `);
    }

    grid.innerHTML = cells.join("");
    grid.querySelectorAll("[data-calendar-date]").forEach(button => {
      button.addEventListener("click", () => {
        selectedCalendarDate = button.dataset.calendarDate;
        renderCalendar();
        renderCalendarAgenda(selectedCalendarDate);
      });
    });

    renderCalendarAgenda(selectedCalendarDate);
  }

  async function loadCalendarEvents() {
    const { start, end } = monthBounds();
    let published = [];

    try {
      const { data, error } = await client.rpc("get_my_calendar_events", {
        p_start: start,
        p_end: end
      });
      if (error) throw error;
      published = data || [];
    } catch (error) {
      console.warn("[Toolkit Calendar]", error.message || error);
    }

    const combined = [...published, ...syntheticCalendarEvents()];
    const seen = new Set();
    calendarEvents = combined.filter(event => {
      const key = `${event.event_date}|${event.title}|${event.event_type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(eventSort);

    renderCalendar();
  }

  function setupCalendarControls() {
    document.getElementById("calendar-prev")?.addEventListener("click", async () => {
      calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
      selectedCalendarDate = null;
      await loadCalendarEvents();
    });

    document.getElementById("calendar-next")?.addEventListener("click", async () => {
      calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
      selectedCalendarDate = null;
      await loadCalendarEvents();
    });

    document.getElementById("calendar-show-all")?.addEventListener("click", () => {
      selectedCalendarDate = null;
      renderCalendar();
      renderCalendarAgenda();
    });
  }

  async function submitPortalHandover(event) {
    event.preventDefault();
    const payload = {
      project_id: document.getElementById("portal-handover-project").value,
      outgoing_batch: document.getElementById("portal-handover-batch").value.trim() || null,
      accomplishments: document.getElementById("portal-handover-accomplishments").value.trim() || null,
      pending_tasks: document.getElementById("portal-handover-pending").value.trim() || null,
      recommendations: document.getElementById("portal-handover-recommendations").value.trim() || null,
      status: "submitted",
      submitted_by: currentUser.id
    };

    if (!payload.project_id) {
      const m = document.getElementById("portal-handover-message");
      m.textContent = "Select a project first.";
      m.className = "admin-message error";
      return;
    }

    const { error } = await client.from("project_handovers").insert(payload);
    const m = document.getElementById("portal-handover-message");
    if (error) {
      m.textContent = error.message;
      m.className = "admin-message error";
      return;
    }

    m.textContent = "Handover submitted.";
    m.className = "admin-message success";
    document.getElementById("portal-handover-form").reset();
    document.getElementById("portal-handover-batch").value = currentProfile.batch || "";
    await loadHandovers();
  }

  async function start() {
    if (configMissing() || !window.supabase?.createClient) {
      if (loading) {
        loading.innerHTML = `
          <strong>Supabase setup required.</strong>
          <span>Edit <code>supabase-config.js</code> and add your Supabase project URL and publishable/anon key.</span>
          <a href="index.html">Return to login</a>
        `;
        loading.classList.add("portal-error");
      }
      return;
    }

    client = window.supabase.createClient(url, key);
    const { data: userData, error: userError } = await client.auth.getUser();
    const user = userData?.user;

    if (userError || !user) {
      window.location.replace("index.html");
      return;
    }

    currentUser = user;

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("id,email,full_name,student_number,year_level,batch,role,status")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      setLoadingCard({
        title: "Profile setup incomplete",
        text: "Your authenticated account exists, but the Toolkit profile could not be loaded.",
        detail: "Ask the program coordinator to verify the profiles table.",
        action: `<button id="status-signout" class="button button-maroon" type="button">Sign out</button>`
      });
      document.getElementById("status-signout")?.addEventListener("click", signOut);
      return;
    }

    currentProfile = profile;

    if (profile.status === "pending") {
      setLoadingCard({
        title: "Registration received",
        text: "Your account is verified but is still Pending Approval.",
        detail: `${profile.full_name} · ${profile.email}${profile.batch ? ` · ${profile.batch}` : ""}`,
        action: `
          <div class="pending-actions">
            <a class="button button-green" href="index.html">Return to public site</a>
            <button id="status-signout" class="button button-outline-maroon" type="button">Sign out</button>
          </div>
        `
      });
      document.getElementById("status-signout")?.addEventListener("click", signOut);
      return;
    }

    if (profile.status === "suspended") {
      setLoadingCard({
        title: "Account suspended",
        text: "Your Toolkit access has been temporarily suspended.",
        detail: "Please contact the program coordinator if you believe this is an error.",
        action: `<button id="status-signout" class="button button-maroon" type="button">Sign out</button>`
      });
      document.getElementById("status-signout")?.addEventListener("click", signOut);
      return;
    }

    if (profile.status === "archived") {
      setLoadingCard({
        title: "Account archived",
        text: "This Toolkit account is archived and no longer has active access.",
        action: `<button id="status-signout" class="button button-maroon" type="button">Sign out</button>`
      });
      document.getElementById("status-signout")?.addEventListener("click", signOut);
      return;
    }

    if (profile.status !== "active") {
      setLoadingCard({
        title: "Access unavailable",
        text: "Your account does not currently have active Toolkit access.",
        action: `<button id="status-signout" class="button button-maroon" type="button">Sign out</button>`
      });
      document.getElementById("status-signout")?.addEventListener("click", signOut);
      return;
    }

    const fullName = profile.full_name || user.email || "Authorized user";
    const email = profile.email || user.email || "";
    const role = profile.role || "student";
    const firstName = String(profile.full_name || user.email || "there")
      .trim()
      .split(/\s+/)[0]
      .replace(/[._-]+.*$/, "") || "there";

    document.querySelectorAll("[data-user-name]").forEach(el => el.textContent = fullName);
    document.querySelectorAll("[data-user-first-name]").forEach(el => el.textContent = firstName);
    document.querySelectorAll("[data-user-email]").forEach(el => el.textContent = email);
    document.querySelectorAll("[data-user-role]").forEach(el => el.textContent = role.charAt(0).toUpperCase() + role.slice(1));
    document.querySelectorAll("[data-user-batch]").forEach(el => el.textContent = profile.batch || "—");
    document.querySelectorAll("[data-user-year]").forEach(el => el.textContent = profile.year_level || "—");

    const initials = fullName
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join("") || "UP";
    document.querySelectorAll("[data-user-initials]").forEach(el => el.textContent = initials);

    const adminLink = document.getElementById("admin-link");
    if (adminLink && ["admin","coordinator"].includes(role)) {
      adminLink.hidden = false;
    }

    const reviewLink = document.getElementById("review-link");
    if (reviewLink && ["admin","coordinator","faculty","preceptor"].includes(role)) {
      reviewLink.hidden = false;
    }

    const knowledgeLink = document.getElementById("knowledge-link");
    if (knowledgeLink && ["admin","coordinator","faculty"].includes(role)) {
      knowledgeLink.hidden = false;
    }

    document.querySelectorAll("[data-sign-out]").forEach(button => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Signing out…";
        await signOut();
      });
    });

    document.getElementById("portal-handover-form")?.addEventListener("submit", submitPortalHandover);

    if (loading) loading.hidden = true;
    if (app) app.hidden = false;
    document.body.classList.remove("portal-is-loading");

    await loadCurrentRotation(user.id);
    setupCalendarControls();
    await loadCommunities();
    await loadProjects();
    await loadHandovers();
    await loadCalendarEvents();
  }

  start();
})();
