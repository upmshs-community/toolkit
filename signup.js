(() => {
  const form = document.getElementById("signup-form");
  const status = document.getElementById("signup-status");
  const submit = document.getElementById("signup-submit");

  if (!form || !status || !submit) return;

  const cfg = window.APP_CONFIG || {};
  const url = cfg.SUPABASE_URL || "";
  const key = cfg.SUPABASE_ANON_KEY || "";

  const missingConfig =
    !url ||
    !key ||
    url.includes("PASTE_YOUR") ||
    key.includes("PASTE_YOUR");

  if (missingConfig || !window.supabase?.createClient) {
    status.textContent = "Supabase is not configured yet. Add your Project URL and publishable/anon key in supabase-config.js.";
    status.classList.add("error");
    submit.disabled = true;
    return;
  }

  const client = window.supabase.createClient(url, key);

  function setStatus(message, type = "") {
    status.textContent = message;
    status.className = "signup-status";
    if (type) status.classList.add(type);
  }

  function validUpEmail(email) {
    return /^[A-Z0-9._%+-]+@up\.edu\.ph$/i.test(email);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const fullName = document.getElementById("signup-name").value.trim();
    const studentNumber = document.getElementById("signup-student-number").value.trim();
    const email = document.getElementById("signup-email").value.trim().toLowerCase();
    const yearLevel = document.getElementById("signup-year-level").value;
    const batch = document.getElementById("signup-batch").value.trim();
    const password = document.getElementById("signup-password").value;
    const confirmPassword = document.getElementById("signup-confirm-password").value;

    if (!validUpEmail(email)) {
      setStatus("Please use a valid @up.edu.ph email address.", "error");
      return;
    }

    if (password.length < 8) {
      setStatus("Password must contain at least 8 characters.", "error");
      return;
    }

    if (password !== confirmPassword) {
      setStatus("Passwords do not match.", "error");
      return;
    }

    submit.disabled = true;
    submit.textContent = "Creating account…";
    setStatus("");

    const redirectUrl = new URL("portal.html", window.location.href).href;

    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
          student_number: studentNumber,
          year_level: yearLevel,
          batch: batch
        }
      }
    });

    submit.disabled = false;
    submit.textContent = "Create Pending Account";

    if (error) {
      setStatus(error.message, "error");
      return;
    }

    if (data?.user && !data?.session) {
      setStatus(
        "Account created. Check your UP Mail and verify your email. After verification, your account will remain Pending Approval until activated by the program coordinator.",
        "success"
      );
      form.reset();
      return;
    }

    if (data?.session) {
      setStatus(
        "Account created. Your account is Pending Approval. Opening the portal status page…",
        "success"
      );
      setTimeout(() => {
        window.location.href = "portal.html";
      }, 900);
      return;
    }

    setStatus(
      "Registration submitted. Please check your email, then wait for coordinator approval.",
      "success"
    );
  });
})();
