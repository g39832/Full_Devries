const loginForm = document.getElementById("loginForm");
const changeForm = document.getElementById("changeForm");
const loginTitle = document.getElementById("login-title");
const loginBtn = document.getElementById("login-btn");
const showChangeBtn = document.getElementById("show-change-btn");
const cancelChangeBtn = document.getElementById("cancel-change-btn");

async function checkFirstRun() {
  const res = await fetch("/first-run");
  const data = await res.json();
  return data.firstRun;
}

async function setInitialPassword(password) {
  const res = await fetch("/set-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  return res.json();
}

async function verifyPassword(password) {
  const res = await fetch("/verify-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  const data = await res.json();
  return data.valid;
}

async function updatePassword(current, newPassword) {
  const res = await fetch("/update-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current, newPassword })
  });
  return res.json();
}

function showForm(formToShow) {
  loginForm.classList.add("hidden");
  changeForm.classList.add("hidden");
  formToShow.classList.remove("hidden");
}

window.addEventListener("DOMContentLoaded", async () => {
  const firstRun = await checkFirstRun();
  if (firstRun) {
    loginTitle.innerText = "Setup Admin Password";
    loginBtn.innerText = "Create Password & Start";
    showChangeBtn.style.display = "none";
  } else {
    showChangeBtn.style.display = "inline-block";
  }
});

// Login
loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  const password = document.getElementById("password").value;
  const firstRun = await checkFirstRun();
  if (firstRun) {
    await setInitialPassword(password);
    alert("Password created!");
    window.location.href = "main.html";
  } else {
    const valid = await verifyPassword(password);
    if (valid) window.location.href = "main.html";
    else alert("Incorrect password!");
  }
});

// Show/Cancel Change Password
showChangeBtn.addEventListener("click", () => showForm(changeForm));
cancelChangeBtn.addEventListener("click", () => showForm(loginForm));

// Update Password
changeForm.addEventListener("submit", async e => {
  e.preventDefault();
  const current = document.getElementById("currentPwd").value;
  const newPass = document.getElementById("newPwd").value;
  const confirmPass = document.getElementById("confirmPwd").value;
  if (newPass !== confirmPass) return alert("Passwords do not match!");
  const res = await updatePassword(current, newPass);
  if (res.success) {
    alert("Password updated!");
    changeForm.reset();
    showForm(loginForm);
  } else {
    alert(res.message || "Error updating password");
  }
});
