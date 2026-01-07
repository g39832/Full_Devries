const loginForm = document.getElementById('loginForm');
const loginTitle = document.getElementById('login-title'); // Your <h2> or <h1> title
const loginBtn = document.getElementById('login-btn');     // Your submit button

// When the page loads, check if it's the first time using the app
window.onload = async () => {
    const isFirstRun = await window.api.checkFirstRun();
    if (isFirstRun) {
        if (loginTitle) loginTitle.innerText = "Setup Admin Password";
        if (loginBtn) loginBtn.innerText = "Create Password & Start";
    }
};

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('password').value;
    const isFirstRun = await window.api.checkFirstRun();

    if (isFirstRun) {
        // Save the first-ever password to SQLite
        await window.api.setInitialPassword(password);
        window.api.loginSuccess();
    } else {
        // Standard login check
        const isValid = await window.api.verifyPassword(password);
        if (isValid) {
            window.api.loginSuccess();
        } else {
            alert("Incorrect Password. Access Denied.");
        }
    }
});
