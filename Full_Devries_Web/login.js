document.addEventListener("DOMContentLoaded", () => {

  const googleLoginBtn = document.getElementById("googleLoginBtn");
  const googleError = document.getElementById("googleError");

  if (!googleLoginBtn) {
    console.error("googleLoginBtn not found in HTML.");
    return;
  }

  function showGoogleError(message) {
    if (!googleError) return;
    googleError.textContent = message;
    googleError.style.display = "block";
  }

  googleLoginBtn.addEventListener("click", async () => {
    googleLoginBtn.disabled = true;
    if (googleError) googleError.style.display = "none";
    try {
      if (!window.supabase || typeof window.supabase.createClient !== "function") {
        throw new Error("Supabase client library failed to load.");
      }

      const configRes = await fetch("/api/supabase-config");
      if (!configRes.ok) throw new Error("Failed to load Supabase configuration.");
      const config = await configRes.json();

      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        throw new Error(
          "Google login is not configured yet. Ask the administrator to complete the Supabase Google provider setup."
        );
      }

      const supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      const redirectTo = window.location.origin + "/auth-callback.html";
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo }
      });

      if (error) throw error;
    } catch (err) {
      console.error("Google login error:", err);
      showGoogleError(err.message || "Google login failed.");
      googleLoginBtn.disabled = false;
    }
  });

});
