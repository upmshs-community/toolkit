(() => {
  const form = document.getElementById("login-form");
  const status = document.getElementById("login-status");
  const oauthButton = document.getElementById("up-mail-login");

  if (!form || !status) return;

  function getClient() {
    const cfg = window.APP_CONFIG || {};
    const url = cfg.SUPABASE_URL || "";
    const key = cfg.SUPABASE_ANON_KEY || "";

    const missing =
      !url ||
      !key ||
      url.includes("PASTE_YOUR") ||
      key.includes("PASTE_YOUR");

    if (missing) {
      status.textContent = "Supabase is not configured yet. Add your project URL and anon key in supabase-config.js.";
      status.classList.add("error");
      return null;
    }

    if (!window.supabase || !window.supabase.createClient) {
      status.textContent = "Supabase client failed to load. Please refresh the page.";
      status.classList.add("error");
      return null;
    }

    return window.supabase.createClient(url, key);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.classList.remove("error", "success");

    const client = getClient();
    if (!client) return;

    const email = form.querySelector('input[type="email"]').value.trim();
    const password = document.getElementById("password").value;
    const submit = form.querySelector('button[type="submit"]');

    submit.disabled = true;
    submit.textContent = "Signing in…";
    status.textContent = "";

    const { data, error } = await client.auth.signInWithPassword({
      email,
      password
    });

    submit.disabled = false;
    submit.textContent = "Sign In";

    if (error) {
      status.textContent = error.message;
      status.classList.add("error");
      return;
    }

    if (!data.session) {
      status.textContent = "Sign-in succeeded but no session was returned.";
      status.classList.add("error");
      return;
    }

    status.textContent = "Signed in. Opening your toolkit…";
    status.classList.add("success");
    window.location.href = "portal.html";
  });

  if (oauthButton) {
    oauthButton.addEventListener("click", async () => {
      status.classList.remove("error", "success");
      const client = getClient();
      if (!client) return;

      status.textContent = "Opening UP Mail / Google sign-in…";

      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: new URL("portal.html", window.location.href).href
        }
      });

      if (error) {
        status.textContent = error.message;
        status.classList.add("error");
      }
    });
  }
})();
