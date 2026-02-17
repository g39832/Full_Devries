document.addEventListener("DOMContentLoaded", () => {

  const loginForm = document.getElementById("loginForm");
  const passwordInput = document.getElementById("password");
  const showResetBtn = document.getElementById("showReset");
  const resetSection = document.getElementById("resetSection");
  const changePasswordBtn = document.getElementById("changePasswordBtn");

  // Hide reset section initially
  resetSection.style.display = "none";

  // =========================
  // LOGIN
  // =========================
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const password = passwordInput.value;

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ password })
      });

      const data = await response.json();

      if (data.success) {
        window.location.href = "/main";
      } else {
        alert(data.message || "Incorrect password.");
        passwordInput.value = "";
        passwordInput.focus();
      }

    } catch (error) {
      console.error("Login error:", error);
      alert("Server error. Please try again.");
    }
  });

  // =========================
  // TOGGLE RESET SECTION
  // =========================
  showResetBtn.addEventListener("click", () => {
    if (resetSection.style.display === "none") {
      resetSection.style.display = "block";
    } else {
      resetSection.style.display = "none";
    }
  });

  // =========================
  // CHANGE PASSWORD
  // =========================
  changePasswordBtn.addEventListener("click", async () => {

    const currentPassword = document.getElementById("currentPassword").value;
    const newPassword = document.getElementById("newPassword").value;

    if (!newPassword || newPassword.length < 4) {
      alert("New password must be at least 4 characters.");
      return;
    }

    try {
      const response = await fetch("/api/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      });

      const data = await response.json();

      if (data.success) {
        alert("Password changed successfully!");
        resetSection.style.display = "none";
        document.getElementById("currentPassword").value = "";
        document.getElementById("newPassword").value = "";
      } else {
        alert(data.message || "Password change failed.");
      }

    } catch (error) {
      console.error("Change password error:", error);
      alert("Server error. Please try again.");
    }

  });

});