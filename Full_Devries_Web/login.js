// login.js
document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm");
  const passwordInput = document.getElementById("password");
  const loginBtn = document.getElementById("login-btn");
  const resetBtn = document.getElementById("show-change-btn");

  // ===== Animate logo on load =====
  const logo = document.getElementById("logo_login");
  logo.style.opacity = 0;
  logo.style.transform = "translateY(-20px)";
  setTimeout(() => {
    logo.style.transition = "all 0.8s ease";
    logo.style.opacity = 1;
    logo.style.transform = "translateY(0)";
  }, 100);

  // ===== Animate inputs and buttons sequentially =====
  const inputs = loginForm.querySelectorAll("input, button");
  inputs.forEach((el, idx) => {
    el.style.opacity = 0;
    el.style.transform = "translateX(100px)";
    setTimeout(() => {
      el.style.transition = `all 0.5s ease ${(idx + 1) * 0.1}s`;
      el.style.opacity = 1;
      el.style.transform = "translateX(0)";
    }, 300);
  });

  // ===== Login submission =====
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const password = passwordInput.value;
    if (password === "123007") {
      // Success animation
      loginBtn.style.transform = "scale(0.95)";
      setTimeout(() => {
        loginBtn.style.transform = "scale(1)";
        // Redirect to main page
        window.location.href = "main.html";
      }, 150);
    } else {
      // Shake animation on wrong password
      loginForm.style.animation = "slideOutLeft 0.3s";
      setTimeout(() => {
        loginForm.style.animation = "slideInRight 0.3s";
      }, 300);
      passwordInput.value = "";
      passwordInput.focus();
      alert("Incorrect password. Try again.");
    }
  });

  // ===== Reset password button =====
  resetBtn.addEventListener("click", () => {
    passwordInput.value = "";
    passwordInput.focus();
  });

  // ===== Optional: Press Enter to focus login =====
  passwordInput.focus();
});
