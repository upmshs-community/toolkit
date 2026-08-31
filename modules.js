(() => {
  const cfg = window.APP_CONFIG || {};
  const loading = document.getElementById("lms-loading");
  const app = document.getElementById("lms-app");
  let client;
  let user;
  let profile;
  let courses = [];
  let modules = [];
  let lessons = [];
  let progress = [];
  let activeCode = "CH205";

  const safe = (v = "") => String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function initials(name = "") {
    return String(name).split(/[\s._-]+/).filter(Boolean).slice(0,2).map(x => x[0]?.toUpperCase()).join("") || "UP";
  }

  function statusFor(lessonId) {
    return progress.find(p => p.lesson_id === lessonId) || null;
  }

  function courseLessons(courseId) {
    const moduleIds = modules.filter(m => m.course_id === courseId).map(m => m.id);
    return lessons.filter(l => moduleIds.includes(l.module_id));
  }

  function pct(completed, total) {
    return total ? Math.round((completed / total) * 100) : 0;
  }

  function progressForLessons(list) {
    const completed = list.filter(l => statusFor(l.id)?.status === "completed").length;
    return { completed, total: list.length, percent: pct(completed, list.length) };
  }

  function lessonHref(id) {
    return `lesson.html?id=${encodeURIComponent(id)}`;
  }

  function setUserUI() {
    const name = profile.full_name || profile.email || user.email || "Toolkit user";
    document.querySelectorAll("[data-user-name]").forEach(x => x.textContent = name);
    document.querySelectorAll("[data-user-email]").forEach(x => x.textContent = profile.email || user.email || "");
    document.querySelectorAll("[data-user-role]").forEach(x => x.textContent = (profile.role || "student").replaceAll("_"," "));
    document.querySelectorAll("[data-user-batch]").forEach(x => x.textContent = profile.batch || "—");
    document.querySelectorAll("[data-user-initials]").forEach(x => x.textContent = initials(name));
  }

  async function loadData() {
    const [courseRes, moduleRes, lessonRes, progressRes] = await Promise.all([
      client.from("lms_courses").select("*").eq("is_active", true).order("sort_order"),
      client.from("lms_modules").select("*").eq("is_published", true).order("sort_order"),
      client.from("lms_lessons").select("*").eq("is_published", true).order("sort_order"),
      client.from("lms_lesson_progress").select("*").eq("user_id", user.id)
    ]);

    for (const result of [courseRes, moduleRes, lessonRes, progressRes]) {
      if (result.error) throw result.error;
    }

    courses = courseRes.data || [];
    modules = moduleRes.data || [];
    lessons = lessonRes.data || [];
    progress = progressRes.data || [];
  }

  async function chooseInitialCourse() {
    const { data } = await client
      .from("rotation_assignments")
      .select("course_code")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);

    const code = String(data?.[0]?.course_code || "").toUpperCase();
    if (courses.some(c => c.code === code)) activeCode = code;
  }

  function renderOverallProgress() {
    const stats = progressForLessons(lessons);
    document.getElementById("lms-overall-progress").textContent = `${stats.percent}%`;
    document.getElementById("lms-overall-progress-bar").style.width = `${stats.percent}%`;
    document.getElementById("lms-overall-detail").textContent =
      `${stats.completed} of ${stats.total} published lessons completed`;
  }

  function renderContinueCard() {
    const card = document.getElementById("lms-continue-card");
    const lastOpened = [...progress]
      .filter(p => p.status !== "completed")
      .sort((a,b) => new Date(b.last_opened_at || b.updated_at || 0) - new Date(a.last_opened_at || a.updated_at || 0))[0];

    let lesson = lastOpened ? lessons.find(l => l.id === lastOpened.lesson_id) : null;

    if (!lesson) {
      const course = courses.find(c => c.code === activeCode);
      const candidateLessons = course ? courseLessons(course.id) : lessons;
      lesson = candidateLessons.find(l => statusFor(l.id)?.status !== "completed") || candidateLessons[0];
    }

    if (!lesson) {
      card.hidden = true;
      return;
    }

    const module = modules.find(m => m.id === lesson.module_id);
    document.getElementById("lms-continue-title").textContent = lesson.title;
    document.getElementById("lms-continue-copy").textContent =
      `${module?.title || "Module"} · ${lesson.estimated_minutes ? `${lesson.estimated_minutes} min` : "Self-paced"}`;
    document.getElementById("lms-continue-link").href = lessonHref(lesson.id);
    card.hidden = false;
  }

  function renderCourse() {
    document.querySelectorAll("[data-course-tab]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.courseTab === activeCode);
    });

    const course = courses.find(c => c.code === activeCode) || courses[0];
    if (!course) {
      document.getElementById("lms-modules").innerHTML = `<div class="table-empty">No LMS course has been published yet.</div>`;
      return;
    }

    activeCode = course.code;
    const courseModuleList = modules.filter(m => m.course_id === course.id);
    const lessonList = courseLessons(course.id);
    const courseStats = progressForLessons(lessonList);

    document.getElementById("lms-course-code").textContent = course.code;
    document.getElementById("lms-course-title").textContent = course.title;
    document.getElementById("lms-course-description").textContent = course.description || "";
    document.getElementById("lms-course-progress").textContent = `${courseStats.percent}%`;
    document.getElementById("lms-course-progress-copy").textContent =
      `${courseStats.completed} of ${courseStats.total} lessons complete`;

    const target = document.getElementById("lms-modules");

    target.innerHTML = courseModuleList.map((module, index) => {
      const moduleLessons = lessons.filter(l => l.module_id === module.id);
      const stats = progressForLessons(moduleLessons);
      const isDone = stats.total > 0 && stats.completed === stats.total;
      const firstIncomplete = moduleLessons.find(l => statusFor(l.id)?.status !== "completed") || moduleLessons[0];

      const rows = moduleLessons.map((lesson, lessonIndex) => {
        const p = statusFor(lesson.id);
        const status = p?.status || "not_started";
        const label = status === "completed" ? "Completed" : status === "in_progress" ? "In progress" : "Not started";
        return `
          <a class="lms-lesson-row" href="${lessonHref(lesson.id)}">
            <span class="lms-lesson-index">${lessonIndex + 1}</span>
            <div>
              <strong>${safe(lesson.title)}</strong>
              <small>${safe((lesson.lesson_type || "reading").replaceAll("_"," "))}${lesson.estimated_minutes ? ` · ${lesson.estimated_minutes} min` : ""}</small>
            </div>
            <span class="lms-lesson-status status-${status}">${label}</span>
            <span class="lms-lesson-arrow">→</span>
          </a>
        `;
      }).join("");

      return `
        <article class="lms-module-card ${isDone ? "is-complete" : ""}">
          <header class="lms-module-card-header">
            <div class="lms-module-number">
              <span>${course.code}</span>
              <strong>${module.module_number}</strong>
            </div>
            <div class="lms-module-title-block">
              <span class="portal-label">${isDone ? "Completed" : `Module ${module.module_number}`}</span>
              <h3>${safe(module.title)}</h3>
              <p>${safe(module.summary || "")}</p>
            </div>
            <div class="lms-module-progress">
              <strong>${stats.percent}%</strong>
              <span>${stats.completed}/${stats.total}</span>
            </div>
          </header>
          <div class="lms-module-progress-track"><i style="width:${stats.percent}%"></i></div>
          <div class="lms-module-lessons">${rows || '<div class="table-empty">No published lessons yet.</div>'}</div>
          ${firstIncomplete ? `<a class="lms-module-continue" href="${lessonHref(firstIncomplete.id)}">${isDone ? "Review module" : "Continue module"} →</a>` : ""}
        </article>
      `;
    }).join("");

    if (!courseModuleList.length) {
      target.innerHTML = `<div class="table-empty">No published modules are available for ${safe(course.code)}.</div>`;
    }
  }

  async function init() {
    try {
      if (!window.supabase?.createClient || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
        throw new Error("Supabase configuration is missing.");
      }

      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData?.user) return location.replace("index.html");
      user = userData.user;

      const { data: profileData, error: profileError } = await client
        .from("profiles")
        .select("email,full_name,role,status,batch,year_level")
        .eq("id", user.id)
        .single();

      if (profileError || !profileData || profileData.status !== "active") {
        return location.replace("portal.html");
      }

      profile = profileData;
      setUserUI();

      document.querySelectorAll("[data-sign-out]").forEach(button => {
        button.addEventListener("click", async () => {
          await client.auth.signOut();
          location.replace("index.html");
        });
      });

      await loadData();
      await chooseInitialCourse();

      document.querySelectorAll("[data-course-tab]").forEach(button => {
        button.addEventListener("click", () => {
          activeCode = button.dataset.courseTab;
          renderCourse();
          renderContinueCard();
        });
      });

      renderOverallProgress();
      renderCourse();
      renderContinueCard();

      loading.hidden = true;
      app.hidden = false;
      document.body.classList.remove("portal-is-loading");
    } catch (error) {
      console.error("[Phase 7A LMS]", error);
      loading.innerHTML = `
        <img src="assets/shs-logo.png" alt="UPM-SHS">
        <strong>Unable to open the learning system</strong>
        <span>${safe(error.message || error)}</span>
        <a href="portal.html">Return to Toolkit</a>
      `;
    }
  }

  init();
})();
