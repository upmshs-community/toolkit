(() => {
  const cfg = window.APP_CONFIG || {};
  const id = new URLSearchParams(window.location.search).get("id");
  const loading = document.getElementById("report-loading");
  const app = document.getElementById("report-app");

  function fatal(message) {
    loading.innerHTML = `
      <strong>Unable to prepare report</strong>
      <span>${message}</span>
      <a href="portal.html#handover">Return to Toolkit</a>
    `;
  }

  function formatDate(value) {
    if (!value) return "—";
    return new Date(value).toLocaleDateString(undefined, {
      year:"numeric", month:"long", day:"numeric"
    });
  }

  async function start() {
    if (!id) {
      fatal("No handover ID was provided.");
      return;
    }

    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      fatal("Supabase is not configured.");
      return;
    }

    const client = window.supabase.createClient(
      cfg.SUPABASE_URL,
      cfg.SUPABASE_ANON_KEY
    );

    const { data: userData } = await client.auth.getUser();
    if (!userData?.user) {
      window.location.replace("index.html");
      return;
    }

    const { data: handover, error } = await client
      .from("project_handovers")
      .select(`
        id,submitted_by,outgoing_batch,status,accomplishments,pending_tasks,recommendations,updated_at,
        projects(title,communities(name,province))
      `)
      .eq("id", id)
      .single();

    if (error || !handover) {
      fatal(error?.message || "Handover record was not found.");
      return;
    }

    let submitter = "Toolkit user";
    const { data: displayName } = await client.rpc("get_profile_display_name", {
      target_user: handover.submitted_by
    });
    if (displayName) submitter = displayName;

    document.getElementById("report-community").textContent =
      `${handover.projects?.communities?.name || "Community"}${handover.projects?.communities?.province ? `, ${handover.projects.communities.province}` : ""}`;
    document.getElementById("report-project").textContent =
      handover.projects?.title || "Project";
    document.getElementById("report-status").textContent =
      (handover.status || "—").replaceAll("_"," ");
    document.getElementById("report-batch").textContent =
      handover.outgoing_batch || "—";
    document.getElementById("report-submitter").textContent =
      submitter;
    document.getElementById("report-date").textContent =
      formatDate(handover.updated_at);
    document.getElementById("report-accomplishments").textContent =
      handover.accomplishments || "No accomplishments recorded.";
    document.getElementById("report-pending").textContent =
      handover.pending_tasks || "No pending tasks recorded.";
    document.getElementById("report-recommendations").textContent =
      handover.recommendations || "No recommendations recorded.";

    document.getElementById("print-report").addEventListener("click", () => window.print());

    loading.hidden = true;
    app.hidden = false;
  }

  start();
})();
