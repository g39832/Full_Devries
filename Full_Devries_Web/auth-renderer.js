const loginForm = document.getElementById("loginForm");
const changeForm = document.getElementById("changeForm");
const loginTitle = document.getElementById("login-title");
const loginBtn = document.getElementById("login-btn");
const showChangeBtn = document.getElementById("show-change-btn");
const cancelChangeBtn = document.getElementById("cancel-change-btn");

// ===== Initial Load =====
window.addEventListener("DOMContentLoaded", async () => {
  const firstRun = await window.api.checkFirstRun();

  if (firstRun) {
    loginTitle.innerText = "Setup Admin Password";
    loginBtn.innerText = "Create Password & Start";
    showChangeBtn.style.display = "none";
  } else {
    showChangeBtn.style.display = "inline-block";
  }
});

// ===== Login =====
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const password = document.getElementById("password").value;
  const firstRun = await window.api.checkFirstRun();

  if (firstRun) {
    await window.api.setInitialPassword(password);
    alert("Password created!");
    loginForm.reset();
    window.api.loginSuccess();
  } else {
    const valid = await window.api.verifyPassword(password);

    if (valid) {
      loginForm.reset();
      window.api.loginSuccess();
    } else {
      alert("Incorrect password!");
    }
  }
});

// ===== Show Change Password Form =====
showChangeBtn.addEventListener("click", () => {
  loginForm.classList.add("hidden");
  changeForm.classList.remove("hidden");
});

// ===== Cancel Change Password =====
cancelChangeBtn.addEventListener("click", () => {
  changeForm.classList.add("hidden");
  loginForm.classList.remove("hidden");
});

// ===== Update Password =====
changeForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const current = document.getElementById("currentPwd").value;
  const newPass = document.getElementById("newPwd").value;
  const confirmPass = document.getElementById("confirmPwd").value;

  if (newPass !== confirmPass) {
    alert("Passwords do not match!");
    return;
  }

  const res = await window.api.updatePassword(current, newPass);

  if (res.success) {
    alert("Password updated!");
    changeForm.reset();
    changeForm.classList.add("hidden");
    loginForm.classList.remove("hidden");
  } else {
    alert(res.message || "Error updating password");
  }
});
